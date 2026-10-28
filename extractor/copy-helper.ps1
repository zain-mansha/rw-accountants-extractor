param(
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$Password='',
  [double]$Scale=2.5
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await($operation,[type]$resultType){
  $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task=$method.MakeGenericMethod($resultType).Invoke($null,@($operation))
  $task.GetAwaiter().GetResult()
}
function AwaitAction($operation){
  $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  $task=$method.Invoke($null,@($operation))
  $task.GetAwaiter().GetResult() | Out-Null
}
function ReadBytes($stream){
  $stream.Seek(0)
  $reader=New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  Await($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
  $bytes=New-Object byte[] ([int]$stream.Size)
  $reader.ReadBytes($bytes)
  $bytes
}
try {
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $sf=Await ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime])
  $pdf=Await ([Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]::LoadFromFileAsync($sf,$Password)) ([Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime])
  $pages=@()
  $Scale=[math]::Min(5.0,[math]::Max(1.5,$Scale))
  for($i=0;$i -lt $pdf.PageCount;$i++){
    $page=$pdf.GetPage($i)
    $render=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $options=New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $options.DestinationWidth=[uint32]([math]::Round($page.Size.Width*$Scale))
    $options.DestinationHeight=[uint32]([math]::Round($page.Size.Height*$Scale))
    AwaitAction($page.RenderToStreamAsync($render,$options))
    $render.Seek(0)
    $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync($render)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime])
    $bitmap=Await($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics,ContentType=WindowsRuntime])
    $output=Join-Path $OutputDirectory (('page-{0:D4}.jpg' -f ($i+1)))
    $outStream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $encoder=Await ([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime]::JpegEncoderId,$outStream)) ([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime])
    $encoder.SetSoftwareBitmap($bitmap)
    AwaitAction($encoder.FlushAsync())
    [IO.File]::WriteAllBytes($output,(ReadBytes $outStream))
    $pages+=@{path=$output;width=[int]$bitmap.PixelWidth;height=[int]$bitmap.PixelHeight}
    $page.Dispose();$render.Dispose();$outStream.Dispose();$bitmap.Dispose()
  }
  @{ok=$true;pages=$pages}|ConvertTo-Json -Compress -Depth 4
} catch {
  @{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress
  exit 1
}
