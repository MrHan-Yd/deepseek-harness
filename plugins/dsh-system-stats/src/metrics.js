/**
 * Readings and arithmetic behind the system-stats Host half.
 *
 * Every figure this plugin shows is a difference between two readings of
 * cumulative counters: busy CPU time over elapsed CPU time, memory in use at
 * one instant, bytes moved between two readings of an interface counter. The
 * platform-specific part — turning the text of `vm_stat`, `/proc/meminfo`,
 * `/proc/net/dev`, or `netstat -ibn` into counters — and every operation on
 * those counters live here, so the arithmetic is testable without a machine
 * reading and the Host half only owns when a reading is taken.
 *
 * A difference that cannot be formed is answered with `null`: no predecessor, a
 * window of zero length, a counter that moved backwards because the interface
 * was reset. A reading the page cannot have is an unavailable reading, never a
 * fabricated one.
 *
 * @module dsh-system-stats/metrics
 */

/** Largest and smallest share this module ever reports. */
const PERCENT_MIN = 0
const PERCENT_MAX = 100

/**
 * Read one number, treating anything not finite as absent.
 * @param value - a value from a counter reading.
 * @returns the value, or 0 when it is not a finite number.
 */
const number = value => (Number.isFinite(value) ? value : 0)

/**
 * Clamp a share into the reported range.
 * @param value - an unclamped percentage.
 * @returns the percentage within [0, 100].
 */
const clampPercent = value => Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, value))

/**
 * Read the machine's cumulative CPU time, per core.
 *
 * `node:os` reports each core's accumulated milliseconds since boot, so two
 * readings of the same core are what a busy share is computed from. Cores the
 * later reading no longer lists (a hot-unplugged core) drop out through the
 * shorter length at comparison time.
 *
 * @param cpus - the `node:os` `cpus()` list.
 * @returns one `{ idle, total }` entry per core, in milliseconds.
 */
export function cpuSnapshot(cpus) {
  const snapshot = []
  for (const core of cpus ?? []) {
    const times = core?.times ?? {}
    snapshot.push({
      idle: number(times.idle),
      total: number(times.user) + number(times.nice) + number(times.sys) + number(times.irq) + number(times.idle),
    })
  }
  return snapshot
}

/**
 * Busy share of one CPU-time difference.
 *
 * @param previous - the earlier snapshot.
 * @param next - the later snapshot.
 * @returns busy percentage within [0, 100], or null when the two readings carry
 * no elapsed CPU time at all.
 */
export function cpuPercentOf(previous, next) {
  let idle = 0
  let total = 0
  const cores = Math.min(previous.length, next.length)
  for (let at = 0; at < cores; at += 1) {
    idle += Math.max(0, next[at].idle - previous[at].idle)
    total += Math.max(0, next[at].total - previous[at].total)
  }
  if (total <= 0) return null
  return clampPercent(PERCENT_MAX - (idle / total) * PERCENT_MAX)
}

/**
 * Throughput of one network-counter difference.
 *
 * @param previous - the earlier counter reading, in bytes.
 * @param next - the later counter reading, in bytes.
 * @param elapsedMs - the window between the two readings, in milliseconds.
 * @returns bytes per second for each direction, or null when the window is
 * unusable. A counter that moved backwards counts as no traffic: the interface
 * was reset, so the window holds no usable difference.
 */
export function ratesOf(previous, next, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null
  const seconds = elapsedMs / 1000
  const rate = (before, after) => {
    const delta = number(after) - number(before)
    return delta > 0 ? delta / seconds : 0
  }
  return {
    receivedBytesPerSecond: rate(previous.receivedBytes, next.receivedBytes),
    sentBytesPerSecond: rate(previous.sentBytes, next.sentBytes),
  }
}

/**
 * Share of a whole.
 * @param part - the numerator.
 * @param whole - the denominator.
 * @returns percentage within [0, 100], or null when the whole is not a positive
 * number.
 */
export function percentOf(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null
  return clampPercent((part / whole) * PERCENT_MAX)
}

/**
 * Parse one macOS `vm_stat` report.
 *
 * @param text - the command's standard output.
 * @returns the page size in bytes (null when the header is not the expected
 * one) and the page count of every named line.
 */
export function parseVmStat(text) {
  const header = /page size of (\d+) bytes/.exec(text)
  const pages = {}
  for (const [, name, count] of text.matchAll(/^"?(.+?)"?:[ \t]+(\d+)\.?$/gm)) {
    pages[name.trim()] = Number(count)
  }
  return { pageSize: header === null ? null : Number(header[1]), pages }
}

/**
 * Memory macOS can hand to a new allocation, from one `vm_stat` reading.
 *
 * The reading counts free, inactive, and speculative pages as reclaimable;
 * purged and file-backed pages stay out of the sum because macOS already
 * charges part of them to the active count, and adding them would report the
 * same bytes twice.
 *
 * @param reading - the parsed `vm_stat` report.
 * @returns reclaimable bytes, or null when the report carried no page size.
 */
export function availableBytesOfVmStat(reading) {
  const pageSize = reading?.pageSize
  if (!Number.isFinite(pageSize)) return null
  const pages = reading.pages ?? {}
  const reclaimable = number(pages['Pages free']) + number(pages['Pages inactive']) + number(pages['Pages speculative'])
  return reclaimable * pageSize
}

/**
 * Parse the memory totals of one `/proc/meminfo` reading.
 *
 * `MemAvailable` is the kernel's own estimate of what a new allocation can have
 * without swapping, which is the figure a person reads as free memory; the
 * older `MemFree` counts clean cache as used and is not used here.
 *
 * @param text - the file's contents.
 * @returns total and available bytes, either of them null when the field is
 * absent (a kernel older than 3.14 has no `MemAvailable`).
 */
export function parseProcMeminfo(text) {
  const field = (name) => {
    const match = new RegExp(`^${name}:[ \t]+(\\d+)[ \t]*kB$`, 'm').exec(text)
    return match === null ? null : Number(match[1]) * 1024
  }
  return { totalBytes: field('MemTotal'), availableBytes: field('MemAvailable') }
}

/**
 * Sum the byte counters of one `/proc/net/dev` reading.
 *
 * Loopback is left out: on a machine that talks to itself, `lo` carries more
 * bytes than every physical interface together, and counting it would report
 * the machine's own chatter as network traffic.
 *
 * @param text - the file's contents.
 * @returns received and sent bytes over every non-loopback interface.
 */
export function parseProcNetDev(text) {
  let receivedBytes = 0
  let sentBytes = 0
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const name = line.slice(0, colon).trim()
    if (name === '' || name === 'lo') continue
    // Eight receive fields then eight transmit fields; the sent-byte counter is
    // the ninth, so a short row is not one interface's counters.
    const fields = line.slice(colon + 1).trim().split(/\s+/)
    if (fields.length < 9) continue
    receivedBytes += number(Number(fields[0]))
    sentBytes += number(Number(fields[8]))
  }
  return { receivedBytes, sentBytes }
}

/**
 * Sum the byte counters of one macOS `netstat -ibn` report.
 *
 * Only the `<Link#n>` row of each interface carries that interface's totals
 * once; the address rows beneath it repeat the same numbers, so counting every
 * row would report each interface three or four times. The address column is
 * present on some link rows and absent on others, so the counters are read from
 * the end of the row, where the column order is fixed.
 *
 * @param text - the command's standard output.
 * @returns received and sent bytes over every non-loopback interface.
 */
export function parseNetstatDarwin(text) {
  let receivedBytes = 0
  let sentBytes = 0
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 10 || !/^<Link#\d+>$/.test(fields[2])) continue
    if (fields[0] === 'lo0') continue
    const received = Number(fields[fields.length - 5])
    const sent = Number(fields[fields.length - 2])
    if (Number.isFinite(received)) receivedBytes += received
    if (Number.isFinite(sent)) sentBytes += sent
  }
  return { receivedBytes, sentBytes }
}
