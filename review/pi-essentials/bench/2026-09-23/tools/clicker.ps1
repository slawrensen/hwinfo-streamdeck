# Persistent DPI-aware clicker: reads "x y" lines (physical pixels) on stdin
# and clicks there at once, answering "ok <ms since start>". Lets a timing
# test click within milliseconds of a keystroke (a fresh PowerShell per click
# costs hundreds of milliseconds). Ends on "quit" or end of input.
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Mouse2 {
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@
[Mouse2]::SetProcessDPIAware() | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
[Console]::Out.WriteLine("ready")
while ($true) {
	$line = [Console]::In.ReadLine()
	if ($null -eq $line -or $line -eq 'quit') { break }
	if ($line.StartsWith('type ')) {
		# OS-level keystrokes into the focused window (SendKeys syntax: plain
		# letters, digits and spaces only here).
		Add-Type -AssemblyName System.Windows.Forms
		[System.Windows.Forms.SendKeys]::SendWait($line.Substring(5))
		[Console]::Out.WriteLine("ok $($sw.ElapsedMilliseconds)")
		continue
	}
	$p = $line.Trim().Split(' ')
	[Mouse2]::SetCursorPos([int]$p[0], [int]$p[1]) | Out-Null
	[Mouse2]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
	Start-Sleep -Milliseconds 40
	[Mouse2]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
	[Console]::Out.WriteLine("ok $($sw.ElapsedMilliseconds)")
}
