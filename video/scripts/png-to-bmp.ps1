# Converts a PNG to the 24-bit BMP that NSIS expects for installer images.
param([Parameter(Mandatory)] [string]$Png, [Parameter(Mandatory)] [string]$Bmp)

Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Bitmap]::new((Resolve-Path $Png).Path)
try {
    $rect = [System.Drawing.Rectangle]::new(0, 0, $source.Width, $source.Height)
    $rgb = $source.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
        $rgb.Save([System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Bmp)), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $rgb.Dispose() }
} finally { $source.Dispose() }
