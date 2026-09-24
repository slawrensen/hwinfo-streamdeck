# One left click at physical screen coordinates (DPI aware), for selecting
# actions on the Stream Deck app canvas from a script. Only ever aimed at
# the Stream Deck window the session has been granted.
param([Parameter(Mandatory)][int]$X, [Parameter(Mandatory)][int]$Y)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Mouse {
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@
[Mouse]::SetProcessDPIAware() | Out-Null
[Mouse]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 60
[Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 90
[Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
