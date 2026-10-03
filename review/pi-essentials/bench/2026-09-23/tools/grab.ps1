# Native-resolution screen capture of a region (physical pixels, DPI aware):
# the app canvas draws each key at about its device resolution, so a crop is
# the device engine's own rendering of the face.
#   grab.ps1 -X <px> -Y <px> -W <px> -H <px> -Out <file.png> [-Scale 3]
param([int]$X, [int]$Y, [int]$W, [int]$H, [string]$Out, [int]$Scale = 1)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DpiG { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
'@
[DpiG]::SetProcessDPIAware() | Out-Null
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
if ($Scale -gt 1) {
	$big = New-Object System.Drawing.Bitmap ($W * $Scale), ($H * $Scale)
	$g2 = [System.Drawing.Graphics]::FromImage($big)
	$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
	$g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
	$g2.DrawImage($bmp, 0, 0, $W * $Scale, $H * $Scale)
	$big.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
} else {
	$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
}
"$Out"
