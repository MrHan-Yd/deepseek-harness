/**
 * The arithmetic and parsers behind the system-stats Host half.
 *
 * Every figure this plugin shows is a difference between two machine readings,
 * so the cases here are the ones a reader would otherwise have to trust: which
 * rows of a counter report belong to an interface, which memory pages count as
 * available, and what a difference answers when there is no usable window.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-system-stats/tests/*.test.mjs"
 *
 * @module dsh-system-stats/tests/metrics
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  availableBytesOfVmStat, cpuPercentOf, cpuSnapshot, parseAdapterStatistics, parseNetstatDarwin,
  parseNetstatWindows, parseProcMeminfo, parseProcNetDev, parseVmStat, percentOf, ratesOf,
} from '../src/metrics.js'

/** One `vm_stat` report, as macOS prints it. */
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     5120.
Pages active:                                 574541.
Pages inactive:                               565208.
Pages speculative:                             12783.
Pages throttled:                                   0.
Pages wired down:                             171591.
Pages purgeable:                               26307.
"Translation faults":                       99887766.
Pages copy-on-write:                          123456.
`

/** One `/proc/meminfo`, reduced to the two fields this plugin reads. */
const MEMINFO = `MemTotal:       32815576 kB
MemFree:         1607968 kB
MemAvailable:   19826748 kB
Buffers:          493184 kB
`

/** One `/proc/net/dev`, with loopback included as the kernel prints it. */
const PROC_NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 23099963041 13014594    0    0    0     0          0         0 23099963041 13014594    0    0    0     0       0          0
  eth0:  8123456789  1234567    0    0    0     0          0         0  1234567890   987654    0    0    0     0       0          0
  eth1:    10000000    10000    0    0    0     0          0         0     2000000    20000    0    0    0     0       0          0
`

/** One `netstat -ibn` report, as macOS prints it: the link row of `lo0` carries
 * no address, the link row of a physical interface does. */
const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                      13014594     0 23099963041 13014594     0 23099963041     0
lo0        16384 127           127.0.0.1       13014594     - 23099963041 13014594     - 23099963041     -
lo0        16384 ::1/128     ::1               13014594     - 23099963041 13014594     - 23099963041     -
en0        1500  <Link#4>    42:01:db:4b:a5:d7  1234567     0  8123456789   987654     0  1234567890     0
en0        1500  192.168.1/24 192.168.1.7       1234567     -  8123456789   987654     -  1234567890     -
utun0      1380  <Link#9>                            50     0       4096       60     0        8192     0
`

/** One Windows `netstat -e` report, whose first counter row is the machine's
 * interface total and whose later rows repeat the same shape. */
const NETSTAT_E = `Interface Statistics

                           Received            Sent

Bytes                     582222382      1834097966
Unicast packets           129841506       105072942
Non-unicast packets         6931338          230484
Discards                          0               0
Errors                            0               0
Unknown protocols                 0
`

/** The same report from a Windows whose labels are translated, so the total is
 * the first row carrying two counters rather than the row named `Bytes`. */
const NETSTAT_E_LOCALIZED = `接口统计

                           接收            发送

字节                   582222382      1834097966
单播数据包             129841506       105072942
有错误                          0               0
`

/** The one line the Windows adapter reader prints: received then sent totals. */
const ADAPTER_TOTALS = `582222382 1834097966
`

test('vm_stat parsing keeps the named page counts and the page size', () => {
  const reading = parseVmStat(VM_STAT)
  assert.equal(reading.pageSize, 16384)
  assert.equal(reading.pages['Pages free'], 5120)
  assert.equal(reading.pages['Pages inactive'], 565208)
  assert.equal(reading.pages['Translation faults'], 99887766)
})

test('a report without the page-size header has no usable page size', () => {
  assert.equal(parseVmStat('Pages free: 12.\n').pageSize, null)
})

test('macOS free memory counts free, inactive, and speculative pages', () => {
  const available = availableBytesOfVmStat(parseVmStat(VM_STAT))
  assert.equal(available, (5120 + 565208 + 12783) * 16384)
})

test('a vm_stat reading without a page size answers no available bytes', () => {
  assert.equal(availableBytesOfVmStat({ pageSize: null, pages: { 'Pages free': 10 } }), null)
})

test('/proc/meminfo reports total and available bytes', () => {
  const reading = parseProcMeminfo(MEMINFO)
  assert.equal(reading.totalBytes, 32815576 * 1024)
  assert.equal(reading.availableBytes, 19826748 * 1024)
})

test('a kernel without MemAvailable reports no available bytes', () => {
  const reading = parseProcMeminfo('MemTotal: 1024 kB\nMemFree: 512 kB\n')
  assert.equal(reading.totalBytes, 1024 * 1024)
  assert.equal(reading.availableBytes, null)
})

test('/proc/net/dev sums every non-loopback interface', () => {
  const reading = parseProcNetDev(PROC_NET_DEV)
  assert.equal(reading.receivedBytes, 8123456789 + 10000000)
  assert.equal(reading.sentBytes, 1234567890 + 2000000)
})

test('/proc/net/dev ignores a row that carries no counter tail', () => {
  const reading = parseProcNetDev('Inter-|   Receive |  Transmit\n  eth0: 7 8 9\n')
  assert.deepEqual(reading, { receivedBytes: 0, sentBytes: 0 })
})

test('netstat counts each interface once, whether or not its row carries an address', () => {
  const reading = parseNetstatDarwin(NETSTAT)
  assert.equal(reading.receivedBytes, 8123456789 + 4096)
  assert.equal(reading.sentBytes, 1234567890 + 8192)
})

test('netstat ignores the header and any row that is not a link row', () => {
  assert.deepEqual(parseNetstatDarwin('Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\n'), { receivedBytes: 0, sentBytes: 0 })
})

test('the Windows interface total is the first row carrying two counters', () => {
  assert.deepEqual(parseNetstatWindows(NETSTAT_E), { receivedBytes: 582222382, sentBytes: 1834097966 })
})

test('a localized Windows netstat report answers the same total', () => {
  assert.deepEqual(parseNetstatWindows(NETSTAT_E_LOCALIZED), { receivedBytes: 582222382, sentBytes: 1834097966 })
})

test('a Windows netstat report without an interface total has no reading', () => {
  assert.equal(parseNetstatWindows('Interface Statistics\n\n                           Received            Sent\n'), null)
})

test('the Windows adapter totals read received then sent', () => {
  assert.deepEqual(parseAdapterStatistics(ADAPTER_TOTALS), { receivedBytes: 582222382, sentBytes: 1834097966 })
})

test('adapter output that carries no total has no reading', () => {
  assert.equal(parseAdapterStatistics(''), null)
  assert.equal(parseAdapterStatistics('Get-NetAdapterStatistics : The term is not recognized\n'), null)
})

test('a CPU snapshot sums the accumulators node reports for one core', () => {
  const snapshot = cpuSnapshot([{ times: { user: 100, nice: 20, sys: 30, idle: 850, irq: 0 } }])
  assert.deepEqual(snapshot, [{ idle: 850, total: 1000 }])
})

test('busy CPU share is the complement of the idle share', () => {
  const previous = [{ idle: 1000, total: 2000 }]
  const next = [{ idle: 1500, total: 3000 }]
  assert.equal(cpuPercentOf(previous, next), 50)
})

test('a window with no elapsed CPU time answers no reading', () => {
  const reading = [{ idle: 1000, total: 2000 }]
  assert.equal(cpuPercentOf(reading, reading), null)
})

test('a core missing from the later reading drops out of the difference', () => {
  const previous = [{ idle: 0, total: 1000 }, { idle: 0, total: 1000 }]
  const next = [{ idle: 500, total: 2000 }]
  assert.equal(cpuPercentOf(previous, next), 50)
})

test('network rates divide the difference over the window', () => {
  const previous = { receivedBytes: 1000, sentBytes: 2000 }
  const next = { receivedBytes: 3000, sentBytes: 4000 }
  assert.deepEqual(ratesOf(previous, next, 2000), { receivedBytesPerSecond: 1000, sentBytesPerSecond: 1000 })
})

test('a window of zero length answers no network rate', () => {
  assert.equal(ratesOf({ receivedBytes: 0, sentBytes: 0 }, { receivedBytes: 1, sentBytes: 1 }, 0), null)
})

test('a counter that moved backwards reports no traffic for that window', () => {
  const previous = { receivedBytes: 5000, sentBytes: 5000 }
  const next = { receivedBytes: 10, sentBytes: 20 }
  assert.deepEqual(ratesOf(previous, next, 1000), { receivedBytesPerSecond: 0, sentBytesPerSecond: 0 })
})

test('a share needs a positive whole to divide by', () => {
  assert.equal(percentOf(50, 200), 25)
  assert.equal(percentOf(1, 0), null)
  assert.equal(percentOf(Number.NaN, 10), null)
})

test('shares stay inside the reported range', () => {
  assert.equal(percentOf(300, 200), 100)
  assert.equal(cpuPercentOf([{ idle: 0, total: 0 }], [{ idle: 0, total: 100 }]), 100)
})
