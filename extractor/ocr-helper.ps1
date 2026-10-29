param([Parameter(Mandatory=$true)][string]$Path,[string]$Password='',[double]$Scale=2.5,[string]$PageList='',[string]$FocusPageList='',[string]$DairyFooterRows='[]',[string]$BankRetryRegions='[]')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$inkGapRepairSource=@'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class InkGapRepair
{
    public sealed class Result
    {
        public Bitmap Bitmap { get; set; }
        public int FilledPixels { get; set; }
    }

    public static Result Repair(Bitmap input, int maxGap, int inkThreshold, int whiteThreshold)
    {
        if (input == null) throw new ArgumentNullException("input");
        maxGap = Math.Max(1, Math.Min(2, maxGap));
        using (var normalized = new Bitmap(input.Width, input.Height, PixelFormat.Format24bppRgb))
        using (var graphics = Graphics.FromImage(normalized))
        {
            graphics.Clear(Color.White);
            graphics.DrawImageUnscaled(input, 0, 0);
            var rect = new Rectangle(0, 0, normalized.Width, normalized.Height);
            var data = normalized.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            byte[] source;
            try
            {
                int length = Math.Abs(data.Stride) * data.Height;
                source = new byte[length];
                Marshal.Copy(data.Scan0, source, 0, length);
            }
            finally { normalized.UnlockBits(data); }

            byte[] repaired = (byte[])source.Clone();
            int stride = Math.Abs(data.Stride), filled = 0;
            int[,] directions = new int[,] { { 1, 0 }, { 0, 1 }, { 1, 1 }, { 1, -1 } };
            for (int y = 0; y < normalized.Height; y++)
            {
                for (int x = 0; x < normalized.Width; x++)
                {
                    int start = y * stride + x * 3;
                    if (Gray(source, start) > inkThreshold) continue;
                    for (int d = 0; d < directions.GetLength(0); d++)
                    {
                        int dx = directions[d, 0], dy = directions[d, 1];
                        int endX = x + dx, endY = y + dy, gap = 0;
                        while (gap < maxGap && endX >= 0 && endX < normalized.Width && endY >= 0 && endY < normalized.Height)
                        {
                            int pos = endY * stride + endX * 3;
                            int gray = Gray(source, pos);
                            if (gray <= inkThreshold) break;
                            if (gray < whiteThreshold) { gap = 0; break; }
                            gap++; endX += dx; endY += dy;
                        }
                        if (gap == 0 || endX < 0 || endX >= normalized.Width || endY < 0 || endY >= normalized.Height) continue;
                        int end = endY * stride + endX * 3;
                        if (Gray(source, end) > inkThreshold) continue;
                        for (int step = 1; step <= gap; step++)
                        {
                            int pos = (y + dy * step) * stride + (x + dx * step) * 3;
                            for (int channel = 0; channel < 3; channel++)
                                repaired[pos + channel] = (byte)((source[start + channel] + source[end + channel]) / 2);
                            filled++;
                        }
                    }
                }
            }

            var output = new Bitmap(normalized.Width, normalized.Height, PixelFormat.Format24bppRgb);
            var outputData = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
            try { Marshal.Copy(repaired, 0, outputData.Scan0, repaired.Length); }
            catch { output.Dispose(); throw; }
            finally { output.UnlockBits(outputData); }
            return new Result { Bitmap = output, FilledPixels = filled };
        }
    }

    public static Bitmap Threshold(Bitmap input, int threshold)
    {
        if (input == null) throw new ArgumentNullException("input");
        using (var normalized = new Bitmap(input.Width, input.Height, PixelFormat.Format24bppRgb))
        using (var graphics = Graphics.FromImage(normalized))
        {
            graphics.Clear(Color.White);
            graphics.DrawImageUnscaled(input, 0, 0);
            var rect = new Rectangle(0, 0, normalized.Width, normalized.Height);
            var inputData = normalized.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            byte[] pixels;
            int stride = Math.Abs(inputData.Stride), length = stride * inputData.Height;
            try { pixels = new byte[length]; Marshal.Copy(inputData.Scan0, pixels, 0, length); }
            finally { normalized.UnlockBits(inputData); }
            for (int y = 0; y < normalized.Height; y++)
                for (int x = 0; x < normalized.Width; x++)
                {
                    int offset = y * stride + x * 3;
                    byte value = Gray(pixels, offset) < threshold ? (byte)0 : (byte)255;
                    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
                }
            var output = new Bitmap(normalized.Width, normalized.Height, PixelFormat.Format24bppRgb);
            var outputData = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
            try { Marshal.Copy(pixels, 0, outputData.Scan0, pixels.Length); }
            catch { output.Dispose(); throw; }
            finally { output.UnlockBits(outputData); }
            return output;
        }
    }

    private static int Gray(byte[] pixels, int offset)
    {
        return (pixels[offset + 2] * 30 + pixels[offset + 1] * 59 + pixels[offset] * 11) / 100;
    }
}
'@
Add-Type -TypeDefinition $inkGapRepairSource -Language CSharp -ReferencedAssemblies ([System.Drawing.Bitmap].Assembly.Location) | Out-Null
function Await($operation, [type]$resultType) {
  if($resultType) {
    $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    $task=$method.MakeGenericMethod($resultType).Invoke($null,@($operation))
  } else {
    $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
    $task=$method.Invoke($null,@($operation))
  }
  $task.GetAwaiter().GetResult()
}
function Read-BitmapOcrResult($bitmap,$engine) {
  $path=Join-Path ([System.IO.Path]::GetTempPath()) (('{0}.png' -f [guid]::NewGuid().ToString('N')));$stream=$null;$softwareBitmap=$null
  try{
    $bitmap.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)
    $file=Await ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime])
    $stream=Await($file.OpenAsync([Windows.Storage.FileAccessMode,Windows,ContentType=WindowsRuntime]::Read)) ([Windows.Storage.Streams.IRandomAccessStream,Windows,ContentType=WindowsRuntime])
    $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime])
    $softwareBitmap=Await($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics,ContentType=WindowsRuntime])
    $result=Await($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime])
    return $result
  }
  finally{if($softwareBitmap){$softwareBitmap.Dispose()};if($stream){$stream.Dispose()};Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue}
}
function Read-BitmapOcrText($bitmap,$engine) {return [string](Read-BitmapOcrResult $bitmap $engine).Text}
function Get-OcrLineConfidence($line){
  $count=0;$total=0.0;foreach($word in $line.Words){try{$total+=[double]$word.Confidence;$count++}catch{}}
  if($count){return $total/$count};return 0.0
}
function Copy-SoftwareBitmapToDrawingBitmap($bitmap){
  $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream;$reader=$null;$memory=$null
  try{
    $encoder=Await ([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime]::PngEncoderId,$stream)) ([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime])
    $encoder.SetSoftwareBitmap($bitmap);Await($encoder.FlushAsync())|Out-Null;$stream.Seek(0)|Out-Null
    $reader=New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0));Await($reader.LoadAsync([uint32]$stream.Size)) ([uint32])|Out-Null
    $bytes=New-Object byte[] ([int]$stream.Size);$reader.ReadBytes($bytes);$memory=New-Object System.IO.MemoryStream(,$bytes);$drawing=[System.Drawing.Bitmap]::new($memory)
    return [pscustomobject]@{Bitmap=$drawing;Memory=$memory;Reader=$reader;Stream=$stream}
  }catch{if($reader){$reader.Dispose()};if($memory){$memory.Dispose()};$stream.Dispose();throw}
}
function Get-SoftwareBitmapInkRatio($bitmap){
  $normalized=[Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap,[Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)
  try{
    $length=[int]($normalized.PixelWidth*$normalized.PixelHeight*4);$buffer=New-Object Windows.Storage.Streams.Buffer([uint32]$length);$normalized.CopyToBuffer($buffer)
    $reader=[Windows.Storage.Streams.DataReader]::FromBuffer($buffer)
    try{
      $bytes=New-Object byte[] $length;$reader.ReadBytes($bytes);$stepX=[math]::Max(1,[int]($normalized.PixelWidth/300));$stepY=[math]::Max(1,[int]($normalized.PixelHeight/500));$dark=0;$samples=0
      for($y=0;$y -lt $normalized.PixelHeight;$y+=$stepY){for($x=0;$x -lt $normalized.PixelWidth;$x+=$stepX){$offset=($y*$normalized.PixelWidth+$x)*4;$gray=($bytes[$offset]*30+$bytes[$offset+1]*59+$bytes[$offset+2]*11)/100;if($gray -lt 220){$dark++};$samples++}}
      if($samples){return [double]$dark/$samples};return 0.0
    }finally{$reader.Dispose()}
  }finally{$normalized.Dispose()}
}
function Read-EnhancedVatCell($bitmap,$scale,$candidate,$engine,$page) {
  # Render only the ambiguous VAT cell at 10x. Keep enough horizontal margin
  # for the decimal mark and the complete printed amount; a tight crop can
  # retain all digits while silently cutting off a faint comma or point.
  $enhancedBitmap=$null
  $cropWidth=[math]::Max(90.0,[double]$candidate.width+40.0)
  $cropHeight=[math]::Max(64.0,[double]$candidate.height+28.0)
  $cropLeft=[math]::Max(0.0,[double]$candidate.x-20.0)
  $cropTop=[math]::Max(0.0,[double]$candidate.y-12.0)
  if($page){
    $highStream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $highBitmap=$null
    try{
      $sourceScaleX=([double]$page.Size.Width*$scale)/(2.0*[double]$bitmap.PixelWidth)
      $sourceScaleY=([double]$page.Size.Height*$scale)/(2.0*[double]$bitmap.PixelHeight)
      $sourceX=[math]::Max(0,$cropLeft*$sourceScaleX)
      $sourceY=[math]::Max(0,$cropTop*$sourceScaleY)
      $sourceWidth=[math]::Min([double]$page.Size.Width-$sourceX,$cropWidth*$sourceScaleX)
      $sourceHeight=[math]::Min([double]$page.Size.Height-$sourceY,$cropHeight*$sourceScaleY)
      $sourceRect=[Windows.Foundation.Rect]::new([double]$sourceX,[double]$sourceY,[double]$sourceWidth,[double]$sourceHeight)
      $highOptions=New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $highOptions.SourceRect=$sourceRect
      $highOptions.DestinationWidth=[uint32]([math]::Round($cropWidth*10))
      $highOptions.DestinationHeight=[uint32]([math]::Round($cropHeight*10))
      Await($page.RenderToStreamAsync($highStream,$highOptions)) | Out-Null
      $highStream.Seek(0) | Out-Null
      $highDecoder=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync($highStream)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime])
      $highBitmap=Await($highDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics,ContentType=WindowsRuntime])
      $highResult=Await($engine.RecognizeAsync($highBitmap)) ([Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime])
      $highText=[string]$highResult.Text
      if($highText -match '^\s*\d[\d\s]*[.,]\s*\d{2}\s*$'){return $highText.Trim()}
      # If a tiny decimal/digit stroke is broken, repair only this already
      # isolated amount crop. Avoid a second OCR pass over every full page.
      $gapSource=$null;$repairedImage=$null
      try{
        $gapSource=Copy-SoftwareBitmapToDrawingBitmap $highBitmap
        $repairedImage=[InkGapRepair]::Repair($gapSource.Bitmap,2,165,220)
        if($repairedImage.FilledPixels -gt 0){$gapText=[string](Read-BitmapOcrText $repairedImage.Bitmap $engine);if($gapText -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*$'){return $gapText.Trim()}}
      }catch{}finally{if($repairedImage -and $repairedImage.Bitmap){$repairedImage.Bitmap.Dispose()};if($gapSource){$gapSource.Bitmap.Dispose();$gapSource.Memory.Dispose();$gapSource.Reader.Dispose();$gapSource.Stream.Dispose()}}
      $enhancedBitmap=$highBitmap
      $highBitmap=$null
    }catch{}
    finally{if($highBitmap){$highBitmap.Dispose()};$highStream.Dispose()}
  }
  $usesEnhanced=$null -ne $enhancedBitmap
  $pngStream=$null;$reader=$null;$memory=$null;$source=$null;$crop=$null;$highSource=$null;$highMemory=$null;$highReader=$null;$highPngStream=$null
  if($usesEnhanced){
    # Work on the already-rendered 10x amount crop. Copying the whole 5x page
    # to System.Drawing for every ambiguous figure was a major time/memory cost.
    $highCopy=Copy-SoftwareBitmapToDrawingBitmap $enhancedBitmap
    $highSource=$highCopy.Bitmap;$highMemory=$highCopy.Memory;$highReader=$highCopy.Reader;$highPngStream=$highCopy.Stream
    $crop=$highSource
    $enhancedBitmap.Dispose();$enhancedBitmap=$null
  }else{
    $pngStream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $encoder=Await ([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime]::PngEncoderId,$pngStream)) ([Windows.Graphics.Imaging.BitmapEncoder,Windows.Graphics,ContentType=WindowsRuntime])
    $encoder.SetSoftwareBitmap($bitmap);Await($encoder.FlushAsync()) | Out-Null;$pngStream.Seek(0) | Out-Null
    $reader=New-Object Windows.Storage.Streams.DataReader($pngStream.GetInputStreamAt(0));Await($reader.LoadAsync([uint32]$pngStream.Size)) ([uint32]) | Out-Null
    $pngBytes=New-Object byte[] ([int]$pngStream.Size);$reader.ReadBytes($pngBytes)
    $memory=New-Object System.IO.MemoryStream(,$pngBytes);$source=[System.Drawing.Bitmap]::new($memory)
  }
  if($highSource){
    # The printed amount may be surrounded by a long receipt rule. Trim to
    # the isolated ink before OCR so the pound sign and whole pounds are not
    # discarded as layout noise.
    $searchHeight=[math]::Max(1,[int]($highSource.Height*.72));$minInkX=$highSource.Width;$minInkY=$searchHeight;$maxInkX=-1;$maxInkY=-1
    for($py=0;$py -lt $searchHeight;$py+=2){
      $rowInk=0;for($px=0;$px -lt $highSource.Width;$px+=2){$pixel=$highSource.GetPixel($px,$py);if((($pixel.R*30+$pixel.G*59+$pixel.B*11)/100) -lt 220){$rowInk++}}
      if($rowInk -le $highSource.Width*.16){for($px=0;$px -lt $highSource.Width;$px+=2){$pixel=$highSource.GetPixel($px,$py);if((($pixel.R*30+$pixel.G*59+$pixel.B*11)/100) -lt 220){if($px -lt $minInkX){$minInkX=$px};if($px -gt $maxInkX){$maxInkX=$px};if($py -lt $minInkY){$minInkY=$py};if($py -gt $maxInkY){$maxInkY=$py}}}}
    }
    if($maxInkX -gt $minInkX -and $maxInkY -gt $minInkY){
      $pad=36;$trimLeft=[math]::Max(0,$minInkX-$pad);$trimTop=[math]::Max(0,$minInkY-$pad);$trimRight=[math]::Min($highSource.Width-1,$maxInkX+$pad);$trimBottom=[math]::Min($searchHeight-1,$maxInkY+$pad)
      $amountTrim=$highSource.Clone([System.Drawing.Rectangle]::new($trimLeft,$trimTop,$trimRight-$trimLeft+1,$trimBottom-$trimTop+1),[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      try{$trimmedText=Read-BitmapOcrText $amountTrim $engine;if($trimmedText -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*$'){$amountTrim.Dispose();if($highSource){$crop.Dispose();$highMemory.Dispose();$highReader.Dispose();$highPngStream.Dispose()};if($source){$source.Dispose();$memory.Dispose();$reader.Dispose();$pngStream.Dispose()};return $trimmedText.Trim()}}catch{}
      $amountInkWidth=$maxInkX-$minInkX
      foreach($currencyCut in @(0.08,0.12,0.16,0.20)){
        $numberLeft=[math]::Min($trimRight,[math]::Max($trimLeft,[int]($minInkX+$amountInkWidth*$currencyCut)))
        $numberCrop=$highSource.Clone([System.Drawing.Rectangle]::new($numberLeft,$trimTop,$trimRight-$numberLeft+1,$trimBottom-$trimTop+1),[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try{$numberText=Read-BitmapOcrText $numberCrop $engine;if($numberText -match '^\s*\d[\d\s,]*[.,]\s*\d{2}\s*$'){$numberCrop.Dispose();$amountTrim.Dispose();if($highSource){$crop.Dispose();$highMemory.Dispose();$highReader.Dispose();$highPngStream.Dispose()};if($source){$source.Dispose();$memory.Dispose();$reader.Dispose();$pngStream.Dispose()};return $numberText.Trim()}}catch{}
        $numberCrop.Dispose()
      }
      $amountTrim.Dispose()
    }
    foreach($threshold in @(160,190,220,245)){
      $thresholdBitmap=[InkGapRepair]::Threshold($highSource,$threshold)
      try{$thresholdText=Read-BitmapOcrText $thresholdBitmap $engine;if($thresholdText -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*$'){$thresholdBitmap.Dispose();if($highSource){$crop.Dispose();$highMemory.Dispose();$highReader.Dispose();$highPngStream.Dispose()};if($source){$source.Dispose();$memory.Dispose();$reader.Dispose();$pngStream.Dispose()};return $thresholdText.Trim()}}catch{}
      $thresholdBitmap.Dispose()
    }
  }
  if($highSource){$width=$crop.Width;$height=$crop.Height;$sourceFactorX=1.0;$sourceFactorY=1.0}
  else{$factor=$scale/2.0;$left=[math]::Max(0,[int][math]::Floor($cropLeft*$factor));$top=[math]::Max(0,[int][math]::Floor($cropTop*$factor));$width=[math]::Min($source.Width-$left,[int][math]::Round($cropWidth*$factor));$height=[math]::Min($source.Height-$top,[int][math]::Round($cropHeight*$factor));$sourceFactorX=1.0;$sourceFactorY=1.0;if($width -lt 1 -or $height -lt 1){return ''};$rect=[System.Drawing.Rectangle]::new($left,$top,$width,$height);$crop=$source.Clone($rect,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)}
  $upper=[math]::Max(1,[int]($crop.Height*.5))
  $groups=New-Object System.Collections.Generic.List[object]
  $current=$null
  # Detect separate digit columns above the baseline and the printed comma/dot below it.
  for($x=0;$x -lt $crop.Width;$x++){
    $ink=0
    for($y=0;$y -lt $upper;$y++){$p=$crop.GetPixel($x,$y);if((($p.R*30+$p.G*59+$p.B*11)/100) -lt 180){$ink++}}
    if($ink){if($null -eq $current -or $x -gt $current[-1]+1){$current=New-Object System.Collections.Generic.List[int];$groups.Add($current)};$current.Add($x)}
  }
  if($groups.Count -ge 2 -and $groups.Count -le 8){
    $separators=New-Object System.Collections.Generic.List[int]
    for($i=0;$i -lt $groups.Count-1;$i++){$gapInk=0;for($x=$groups[$i][-1]+1;$x -lt $groups[$i+1][0];$x++){for($y=$upper;$y -lt $crop.Height;$y++){$p=$crop.GetPixel($x,$y);if((($p.R*30+$p.G*59+$p.B*11)/100) -lt 180){$gapInk++}}};if($gapInk -ge 2){$separators.Add($i+1)}}
    # A printed money decimal has two digit groups after it. Two OCR groups
    # can each contain a pair of touching digits (for example `18,22`); in
    # that case require visible punctuation ink below the baseline between
    # them, then OCR each side separately.
    $decimalPositions=@($separators|Where-Object{$groups.Count-$_ -eq 2})
    if($groups.Count -eq 2 -and $separators -contains 1){$decimalPositions=@(1)}
    if($decimalPositions.Count){
      $position=$decimalPositions[$decimalPositions.Count-1]
      $pairedDigitGroups=$groups.Count -eq 2
      $expectedRightDigits=if($pairedDigitGroups){2}else{$groups.Count-$position}
      $leftStart=[math]::Max(0,$groups[0][0]-12);$leftEnd=[math]::Min($crop.Width-1,$groups[$position-1][-1]+12)
      $rightStart=[math]::Max(0,$groups[$position][0]-12);$rightEnd=[math]::Min($crop.Width-1,$groups[-1][-1]+12)
      $readPart={param($part,$ocrEngine)
        $minX=$part.Width;$minY=$part.Height;$maxX=-1;$maxY=-1
        for($py=0;$py -lt $part.Height;$py++){for($px=0;$px -lt $part.Width;$px++){$pixel=$part.GetPixel($px,$py);if((($pixel.R*30+$pixel.G*59+$pixel.B*11)/100) -lt 185){if($px -lt $minX){$minX=$px};if($px -gt $maxX){$maxX=$px};if($py -lt $minY){$minY=$py};if($py -gt $maxY){$maxY=$py}}}}
        if($maxX -lt $minX -or $maxY -lt $minY){return ''}
        $pad=8;$trimLeft=[math]::Max(0,$minX-$pad);$trimTop=[math]::Max(0,$minY-$pad);$trimWidth=[math]::Min($part.Width-$trimLeft,$maxX-$trimLeft+$pad+1);$trimHeight=[math]::Min($part.Height-$trimTop,$maxY-$trimTop+$pad+1)
        $trim=$part.Clone([System.Drawing.Rectangle]::new($trimLeft,$trimTop,$trimWidth,$trimHeight),[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        foreach($zoom in @(1,2,3,4)){
          $scaled=[System.Drawing.Bitmap]::new($trim.Width*$zoom,$trim.Height*$zoom,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
          $g=[System.Drawing.Graphics]::FromImage($scaled);$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$g.DrawImage($trim,0,0,$scaled.Width,$scaled.Height)|Out-Null
          $path=Join-Path ([System.IO.Path]::GetTempPath()) (('{0}.png' -f [guid]::NewGuid().ToString('N')));$scaled.Save($path,[System.Drawing.Imaging.ImageFormat]::Png);$stream=$null;$b=$null;$text=''
          try{$file=Await ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime]);$stream=Await($file.OpenAsync([Windows.Storage.FileAccessMode,Windows,ContentType=WindowsRuntime]::Read)) ([Windows.Storage.Streams.IRandomAccessStream,Windows,ContentType=WindowsRuntime]);$d=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]);$b=Await($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows,ContentType=WindowsRuntime]);$r=Await($ocrEngine.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime]);$text=[string]$r.Text}
          catch{}
          finally{if($stream){$stream.Dispose()};if($b){$b.Dispose()};$g.Dispose();$scaled.Dispose();Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue}
          if($text -match '\d'){$trim.Dispose();return $text}
        }
        $trim.Dispose();return ''
      }
      $digitHeight=$crop.Height
      $partSource=$crop
      $partLeft=[int][math]::Floor($leftStart*$sourceFactorX);$partRight=[int][math]::Floor($leftEnd*$sourceFactorX)
      $partRightStart=[int][math]::Floor($rightStart*$sourceFactorX);$partRightEnd=[int][math]::Floor($rightEnd*$sourceFactorX)
      $partHeight=[math]::Min($partSource.Height,[int][math]::Ceiling($digitHeight*$sourceFactorY))
      $leftPart=$partSource.Clone([System.Drawing.Rectangle]::new($partLeft,0,$partRight-$partLeft+1,$partHeight),[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $rightPart=$partSource.Clone([System.Drawing.Rectangle]::new($partRightStart,0,$partRightEnd-$partRightStart+1,$partHeight),[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $leftText=&$readPart $leftPart $engine;$rightText=if($highSource){''}else{&$readPart $rightPart $engine}
      $leftDigits=[regex]::Replace([string]$leftText,'\D','');$rightDigits=[regex]::Replace([string]$rightText,'\D','')
      if($highSource -and $rightDigits.Length -ne $expectedRightDigits){
        $digitImages=New-Object System.Collections.Generic.List[object]
        $canvasWidth=0
        for($digitIndex=$position;$digitIndex -lt $groups.Count;$digitIndex++){
          $singleStart=[math]::Max(0,[int][math]::Floor(($groups[$digitIndex][0]-1)*$sourceFactorX))
          $singleEnd=[math]::Min($highSource.Width-1,[int][math]::Ceiling(($groups[$digitIndex][-1]+1)*$sourceFactorX))
          $single=$highSource.Clone([System.Drawing.Rectangle]::new($singleStart,0,$singleEnd-$singleStart+1,$highSource.Height),[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
          $digitImages.Add($single);$canvasWidth+=$single.Width
        }
        $spacing=24;$canvas=[System.Drawing.Bitmap]::new($canvasWidth+$spacing*($digitImages.Count+1),$highSource.Height,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $canvasGraphics=[System.Drawing.Graphics]::FromImage($canvas);$canvasGraphics.Clear([System.Drawing.Color]::White);$drawX=$spacing
        foreach($digitImage in $digitImages){$canvasGraphics.DrawImage($digitImage,$drawX,0,$digitImage.Width,$digitImage.Height)|Out-Null;$drawX+=$digitImage.Width+$spacing}
        $spacedText=&$readPart $canvas $engine;$spacedDigits=[regex]::Replace([string]$spacedText,'\D','')
        if($spacedDigits.Length -eq $expectedRightDigits){$rightDigits=$spacedDigits}
        elseif(-not $rightDigits){$rightText=&$readPart $rightPart $engine;$rightDigits=[regex]::Replace([string]$rightText,'\D','')}
        $canvasGraphics.Dispose();$canvas.Dispose();foreach($digitImage in $digitImages){$digitImage.Dispose()}
      }
      $leftPart.Dispose();$rightPart.Dispose()
      $validLeftDigits=if($pairedDigitGroups){$leftDigits.Length -ge 1}else{$leftDigits.Length -eq $position}
      if($leftDigits -and $rightDigits -and $validLeftDigits -and $rightDigits.Length -eq $expectedRightDigits){$output=$leftDigits+'.'+$rightDigits;if($highSource){$crop.Dispose();$highMemory.Dispose();$highReader.Dispose();$highPngStream.Dispose()};if($source){$source.Dispose();$memory.Dispose();$reader.Dispose();$pngStream.Dispose()};return $output}
    }
  }
  if($crop){$crop.Dispose()};if($highSource){$highMemory.Dispose();$highReader.Dispose();$highPngStream.Dispose()};if($source){$source.Dispose();$memory.Dispose();$reader.Dispose();$pngStream.Dispose()};return ''
}
function Read-EnhancedReceiptRegion($bitmap,$scale,$left,$top,$width,$height,$engine,$page){
  $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream;$enhanced=$null
  try{
    $scaleX=([double]$page.Size.Width*$scale)/(2.0*[double]$bitmap.PixelWidth);$scaleY=([double]$page.Size.Height*$scale)/(2.0*[double]$bitmap.PixelHeight)
    $sourceX=[math]::Max(0.0,[double]$left*$scaleX);$sourceY=[math]::Max(0.0,[double]$top*$scaleY);$sourceWidth=[math]::Min([double]$page.Size.Width-$sourceX,[double]$width*$scaleX);$sourceHeight=[math]::Min([double]$page.Size.Height-$sourceY,[double]$height*$scaleY)
    if($sourceWidth -le 0 -or $sourceHeight -le 0){return @{Text='';Lines=@()}}
    $sourceRect=[Windows.Foundation.Rect]::new($sourceX,$sourceY,$sourceWidth,$sourceHeight);$options=New-Object Windows.Data.Pdf.PdfPageRenderOptions;$options.SourceRect=$sourceRect;$options.DestinationWidth=[uint32]([math]::Round([double]$width*10));$options.DestinationHeight=[uint32]([math]::Round([double]$height*10))
    Await($page.RenderToStreamAsync($stream,$options))|Out-Null;$stream.Seek(0)|Out-Null;$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]);$enhanced=Await($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics,ContentType=WindowsRuntime]);$result=Await($engine.RecognizeAsync($enhanced)) ([Windows.Media.Ocr.OcrResult,Windows,ContentType=WindowsRuntime]);$lines=New-Object System.Collections.Generic.List[object]
    foreach($line in $result.Lines){$words=@($line.Words);if(!$words.Count){continue};$rect=$words[0].BoundingRect;$lines.Add([pscustomobject]@{page=0;text=[string]$line.Text;x=[double]$left+[double]$rect.X/10.0;y=[double]$top+[double]$rect.Y/10.0;width=[double]$rect.Width/10.0;height=[double]$rect.Height/10.0})}
    return @{Text=[string]$result.Text;Lines=$lines.ToArray()}
  }catch{return @{Text='';Lines=@()}}finally{if($enhanced){$enhanced.Dispose()};$stream.Dispose()}
}
function Read-DairyFreshFooterRegion($bitmap,$scale,$left,$top,$width,$height,$engine,$page){
  # The printer's pale address watermark crosses Dairy Fresh's right-hand
  # totals column. OCR the closing block at a moderate crop scale, then try a
  # few contrast thresholds so black printed figures can be separated from
  # the lighter overprint. Each result stays separately tagged for consensus
  # parsing; this routine never derives VAT or totals.
  $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream;$software=$null;$drawing=$null;$copy=$null;$variants=New-Object System.Collections.Generic.List[object]
  try{
    $sourceScaleX=([double]$page.Size.Width*$scale)/(2.0*[double]$bitmap.PixelWidth);$sourceScaleY=([double]$page.Size.Height*$scale)/(2.0*[double]$bitmap.PixelHeight)
    $sourceX=[math]::Max(0.0,[double]$left*$sourceScaleX);$sourceY=[math]::Max(0.0,[double]$top*$sourceScaleY);$sourceWidth=[math]::Min([double]$page.Size.Width-$sourceX,[double]$width*$sourceScaleX);$sourceHeight=[math]::Min([double]$page.Size.Height-$sourceY,[double]$height*$sourceScaleY)
    if($sourceWidth -le 0 -or $sourceHeight -le 0){return @{Text='';Lines=@()}}
    $sourceRect=[Windows.Foundation.Rect]::new($sourceX,$sourceY,$sourceWidth,$sourceHeight);$options=New-Object Windows.Data.Pdf.PdfPageRenderOptions;$options.SourceRect=$sourceRect;$options.DestinationWidth=[uint32]([math]::Round([double]$width*5));$options.DestinationHeight=[uint32]([math]::Round([double]$height*5))
    Await($page.RenderToStreamAsync($stream,$options))|Out-Null;$stream.Seek(0)|Out-Null;$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]);$software=Await($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics,ContentType=WindowsRuntime]);$copy=Copy-SoftwareBitmapToDrawingBitmap $software;$drawing=$copy.Bitmap
    $allLines=New-Object System.Collections.Generic.List[object];$allText=New-Object System.Collections.Generic.List[string]
    $variants.Add([pscustomobject]@{id=0;bitmap=$drawing})
    foreach($threshold in @(165,185,205,225)){$thresholdBitmap=[InkGapRepair]::Threshold($drawing,$threshold);$variants.Add([pscustomobject]@{id=$threshold;bitmap=$thresholdBitmap})}
    foreach($variant in $variants){
      $result=Read-BitmapOcrResult $variant.bitmap $engine;if($result.Text){$allText.Add([string]$result.Text)}
      foreach($line in $result.Lines){$words=@($line.Words);if(!$words.Count){continue};$rect=$words[0].BoundingRect;$allLines.Add([pscustomobject]@{page=0;text=[string]$line.Text;x=[double]$left+[double]$rect.X/5.0;y=[double]$top+[double]$rect.Y/5.0;width=[double]$rect.Width/5.0;height=[double]$rect.Height/5.0;dairyVariant=[int]$variant.id})}
    }
    return @{Text=($allText -join "`n");Lines=$allLines.ToArray()}
  }catch{return @{Text='';Lines=@()}}finally{foreach($variant in $variants){if($variant.id -ne 0 -and $variant.bitmap){$variant.bitmap.Dispose()}};if($drawing){$drawing.Dispose()};if($copy){$copy.Memory.Dispose();$copy.Reader.Dispose();$copy.Stream.Dispose()};if($software){$software.Dispose()};$stream.Dispose()}
}
try {
  $storageFile=Await ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime])
  $pdf=Await ([Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]::LoadFromFileAsync($storageFile,$Password)) ([Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime])
  $ocrType=[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
  $availableLanguages=@($ocrType::AvailableRecognizerLanguages)
  $language=$availableLanguages|Where-Object{$_.LanguageTag -eq 'en-GB'}|Select-Object -First 1
  if(-not $language){throw 'The required English (United Kingdom) Windows OCR recognizer is missing. Start Extractor with its network launcher so it can install the OCR pack, then try again.'}
  $engine=$ocrType::TryCreateFromLanguage($language)
  if(-not $engine){throw 'Windows could not start the English (United Kingdom) OCR recognizer. Restart Windows, then run the Extractor network launcher again.'}
  $ocrLanguage=[string]$engine.RecognizerLanguage.LanguageTag
  if($ocrLanguage -ne 'en-GB'){throw "Extractor requires the English (United Kingdom) OCR recognizer; Windows selected '$ocrLanguage'. Restart Extractor after installing the required OCR pack."}
  $parts=New-Object System.Collections.Generic.List[string]
  $ocrLines=New-Object System.Collections.Generic.List[object]
  $visualPages=New-Object System.Collections.Generic.List[int]
  $Scale=[math]::Min(5.0,[math]::Max(1.5,$Scale))
  if($PageList){$pageIndexes=@($PageList.Split(',')|ForEach-Object{[int]$n=0;if([int]::TryParse($_,[ref]$n)-and $n -ge 1 -and $n -le $pdf.PageCount){$n-1}}|Sort-Object -Unique)}else{$pageIndexes=@(0..($pdf.PageCount-1))}
  $focusPageNumbers=@($FocusPageList.Split([char]44)|ForEach-Object{[int]$n=0;if([int]::TryParse($_,[ref]$n)-and $n -ge 1 -and $n -le $pdf.PageCount){$n}}|Sort-Object -Unique)
  $dairyFooterRows=@();try{$dairyFooterRows=@($DairyFooterRows|ConvertFrom-Json)}catch{$dairyFooterRows=@()}
  $bankRetryRegions=@();try{$bankRetryRegions=@($BankRetryRegions|ConvertFrom-Json)}catch{$bankRetryRegions=@()}
  $processedPageCount=0
  foreach($index in $pageIndexes) {
    $page=$pdf.GetPage($index)
    $pageLines=New-Object System.Collections.Generic.List[object]
    $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    # A bank reconciliation retry rereads only the printed vertical interval
    # between the last confirmed balance and the first mismatched one.
    $bankRegion=$bankRetryRegions|Where-Object{[int]$_.page -eq ($index+1)}|Select-Object -First 1
    $regionTop=0.0
    $options=New-Object Windows.Data.Pdf.PdfPageRenderOptions
    if($bankRegion){
      $regionTop=[math]::Max(0.0,[double]$bankRegion.top)
      $regionBottom=[math]::Min([double]$page.Size.Height*2.0,[double]$bankRegion.bottom)
      $sourceTop=$regionTop/2.0;$sourceHeight=[math]::Max(1.0,($regionBottom-$regionTop)/2.0)
      $options.SourceRect=[Windows.Foundation.Rect]::new(0.0,$sourceTop,[double]$page.Size.Width,$sourceHeight)
      $options.DestinationWidth=[uint32]([math]::Round($page.Size.Width*$Scale))
      $options.DestinationHeight=[uint32]([math]::Max(1,[math]::Round($sourceHeight*$Scale)))
    }else{
      # Higher rendering resolution preserves small decimal marks and digits.
      $options.DestinationWidth=[uint32]([math]::Round($page.Size.Width*$Scale))
      $options.DestinationHeight=[uint32]([math]::Round($page.Size.Height*$Scale))
    }
    Await($page.RenderToStreamAsync($stream,$options)) | Out-Null
    $stream.Seek(0)
    $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime])
    $bitmap=Await($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics,ContentType=WindowsRuntime])
    $result=Await($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime])
    if($result.Text){$parts.Add($result.Text)}
    foreach($line in $result.Lines){$words=@($line.Words);if($words.Count){$rect=$words[0].BoundingRect;$geometryScale=2.0/$Scale;$ocrY=if($bankRegion){$regionTop+[double]$rect.Y*$geometryScale}else{[double]$rect.Y*$geometryScale};$ocrLine=[pscustomobject]@{page=$index+1;text=$line.Text;x=[double]$rect.X*$geometryScale;y=$ocrY;width=[double]$rect.Width*$geometryScale;height=[double]$rect.Height*$geometryScale;confidence=(Get-OcrLineConfidence $line)};$ocrLines.Add($ocrLine);$pageLines.Add($ocrLine)}}
    $hasVisualContent=$pageLines.Count -gt 0
    if(-not $hasVisualContent){try{$hasVisualContent=(Get-SoftwareBitmapInkRatio $bitmap) -ge 0.012}catch{$hasVisualContent=$false}}
    if($hasVisualContent){$visualPages.Add($index+1)}
    # Some multi-page receipt scans rotate individual slips by 180 degrees.
    # Retry only sparse, nonblank pages at 5x, and map coordinates back to the
    # original page so the ordinary supplier parsers can still read totals.
    if(-not $bankRegion -and $Scale -ge 4.5 -and $hasVisualContent -and $pageLines.Count -lt 5){
      $drawingCopy=$null
      try{
        $drawingCopy=Copy-SoftwareBitmapToDrawingBitmap $bitmap
        $drawingCopy.Bitmap.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone)
        $rotated=Read-BitmapOcrResult $drawingCopy.Bitmap $engine
        if($rotated.Lines.Count -gt $result.Lines.Count){
          if($rotated.Text){$parts.Add($rotated.Text)}
          foreach($line in $rotated.Lines){$words=@($line.Words);if($words.Count){$rect=$words[0].BoundingRect;$geometryScale=2.0/$Scale;$rotatedLine=[pscustomobject]@{page=$index+1;text=$line.Text;x=[double]($bitmap.PixelWidth-$rect.X-$rect.Width)*$geometryScale;y=[double]($bitmap.PixelHeight-$rect.Y-$rect.Height)*$geometryScale;width=[double]$rect.Width*$geometryScale;height=[double]$rect.Height*$geometryScale};$ocrLines.Add($rotatedLine);$pageLines.Add($rotatedLine)}}
        }
      }catch{}finally{if($drawingCopy){$drawingCopy.Bitmap.Dispose();$drawingCopy.Memory.Dispose();$drawingCopy.Reader.Dispose();$drawingCopy.Stream.Dispose()}}
    }
    # On scanned Maspo invoices the full-page OCR can confuse small summary
    # digits (for example 8 with 3). Re-scan only ambiguous numbers in the
    # printed VAT column, thresholded and enlarged; this reads the invoice
    # value directly and does not reconcile or calculate VAT.
    # Summary labels vary across scanned Maspo layouts: the printed text may
    # omit "in" or be read as "tn". Include all forms so the VAT cell gets its
    # dedicated 5x crop retry even when the full-page OCR label is imperfect.
    $summaryLabels=if($bankRegion){@()}else{@($pageLines.ToArray()|Where-Object{[string]$_.text -match '\btot[a-z]{0,2}\s+(?:(?:in|tn)\s+)?GBP\b'})}
    $closesInvoice=if($bankRegion){$false}else{@($pageLines.ToArray()|Where-Object{[string]$_.text -match '^\s*total\s*:'}).Count -and @($pageLines.ToArray()|Where-Object{[string]$_.text -match '\bin\s+words\s*:'}).Count}
    foreach($label in $summaryLabels){$candidates=@($pageLines.ToArray()|Where-Object{$_.y -ge ($label.y-18) -and $_.y -le ($label.y+190) -and $_.x -ge ($label.x+300) -and $_.x -le ($label.x+390) -and [string]$_.text -match '^[\s0-9OoMmEe\u00DF\u1E9E.,;:-]+$' -and [string]$_.text -match '\d|[OoMm]'});foreach($candidate in $candidates){$raw=[string]$candidate.text;if($raw -match '^\s*(?:0+(?:[.,;]0{1,2})?|[Oo][.,;]?[Oo]{0,2}|[Oo][Mm]|ODO)\s*$'){continue};if($raw -match '^\s*-?\d[\d\s,]*[.,]\s*\d{2}\s*$'){continue};if(-not $closesInvoice -and $raw -match '[.,;]' -and $raw -notmatch '[OoMm]'){continue};try{$improved=[string](Read-EnhancedVatCell $bitmap $Scale $candidate $engine $page);if($improved -match '^\s*[Oo]\s*$'){$candidate.text='0.00'}elseif($improved -match '^[\s0-9OoMmEe\u00DF\u1E9E.,;:-]+$' -and $improved -match '\d'){$candidate.text=$improved.Trim();if($candidate.text -match '^\s*0\s*$'){$candidate.text='0.00'}}}catch{}}
    }
    # On some long invoices the closing page's compact VAT table is legible
    # but OCR drops its `Total in GBP` label. If that page has no item grid,
    # locate an ambiguous VAT-column cell beside an aligned net amount and enhance it.
    # The closing-page check keeps this retry away from product VAT cells.
    if($closesInvoice -and -not @($pageLines.ToArray()|Where-Object{$_.y -lt 1400 -and [string]$_.text -match '\b(?:vat\s*rate|item\s+name|item\s+no\.?|quantity\s+unit|net\s+price)\b'}).Count){
      $closingVatCells=New-Object System.Collections.Generic.List[object]
      foreach($candidate in $pageLines.ToArray()){
        if($candidate.x -lt 1600 -or $candidate.x -ge 1755 -or $candidate.y -ge 900 -or [string]$candidate.text -notmatch '^[\s0-9OoMmEe\u00DF\u1E9E.,;:-]+$' -or [string]$candidate.text -notmatch '\d'){continue}
        $alignedLeft=@($pageLines.ToArray()|Where-Object{[math]::Abs([double]$_.y-[double]$candidate.y) -le 18 -and $_.x -ge 1400 -and $_.x -lt 1600 -and [string]$_.text -match '\d[\d,.;]*'})
        if($alignedLeft.Count){$closingVatCells.Add($candidate)}
      }
      foreach($candidate in $closingVatCells){$raw=[string]$candidate.text;if($raw -match '^\s*(?:0+(?:[.,;]0{1,2})?|[Oo][.,;]?[Oo]{0,2}|[Oo][Mm]|ODO)\s*$'){continue};if($raw -match '^\s*-?\d[\d\s,]*[.,]\s*\d{2}\s*$'){continue};try{$improved=[string](Read-EnhancedVatCell $bitmap $Scale $candidate $engine $page);if($improved -match '^\s*[Oo]\s*$'){$candidate.text='0.00'}elseif($improved -match '^[\s0-9OoMmEe\u00DF\u1E9E.,;:-]+$' -and $improved -match '\d'){$candidate.text=$improved.Trim();if($candidate.text -match '^\s*0\s*$'){$candidate.text='0.00'}}}catch{}}
    }
    # Dairy Fresh repeats supplier artwork down the right edge, which makes full-page OCR
    # merge the amount column with its logo. On a requested 5x retry, scan only the closing
    # invoice page and only the compact printed footer region below the final product row.
    if(-not $bankRegion -and $Scale -ge 4.5 -and $focusPageNumbers -contains ($index+1)){
      # Use the left-hand product-description column to find the last item.
      # Quantity digits and stray watermark marks in the right columns can sit
      # below the footer, so they must not move the crop start past the totals.
      $bodyLines=@($pageLines.ToArray()|Where-Object{[double]$_.x -ge 200 -and [double]$_.x -lt 1200 -and [double]$_.y -gt 700 -and [double]$_.y -lt 2450 -and [string]$_.text -match '[A-Za-z]{3}'})
      $lastBodyLine=$bodyLines|Sort-Object {[double]$_.y} -Descending|Select-Object -First 1
      # The footer begins beneath the final product row. Anchoring the crop
      # above that row clipped closing totals on short three-page invoices.
      $focusTop=if($lastBodyLine){[math]::Max(650.0,[double]$lastBodyLine.y+30.0)}else{1450.0}
      # The invoice's printed VAT and total are below the product grid. A
      # fixed 800-unit crop ended before those rows on pages with short grids,
      # producing a false "unreadable" result even when the closing block was
      # present. OCR to the physical bottom of the page instead.
      $pageBottom=[double]$page.Size.Height*2.0
      $footerHeight=[math]::Max(200.0,$pageBottom-$focusTop)
      try{
        $footerRegion=Read-DairyFreshFooterRegion $bitmap $Scale 1400.0 $focusTop 550.0 $footerHeight $engine $page
        if($footerRegion.Text){$parts.Add([string]$footerRegion.Text)}
        foreach($footerLine in $footerRegion.Lines){$footerLine.page=$index+1;$ocrLines.Add($footerLine);$pageLines.Add($footerLine)}
      }catch{}
      # The full-page OCR can lose these labels under the repeated watermark.
      # Use row locations measured from the first-pass OCR, then read each
      # printed row as its own 10x image. Accept a row only when that crop has
      # one unambiguous money figure.
      foreach($footerTarget in @($dairyFooterRows|Where-Object{[int]$_.page -eq ($index+1)})){
        foreach($field in @(@{kind='vat';y=[double]$footerTarget.vatY;label='Total VAT Amt'},@{kind='total';y=[double]$footerTarget.totalY;label='Total'})){
          $left=1400.0;$top=[math]::Max(0.0,[double]$field.y-20.0)
          try{
            $focusedRow=Read-EnhancedReceiptRegion $bitmap $Scale $left $top 600.0 72.0 $engine $page
            $matches=[regex]::Matches([string]$focusedRow.Text,'(?<!\d)(?:\d{1,3}(?:[ ,]\d{3})*|\d+)[.,]\s*\d{2}(?!\d)')
            $moneyValues=@($matches|ForEach-Object{$_.Value -replace '\s+',''}|Select-Object -Unique)
            if($moneyValues.Count -eq 1){
              $label=[pscustomobject]@{page=$index+1;text=[string]$field.label;x=1450.0;y=[double]$field.y;width=130.0;height=30.0;dairyVariant=901}
              $amount=[pscustomobject]@{page=$index+1;text=[string]$moneyValues[0];x=1700.0;y=[double]$field.y;width=150.0;height=30.0;dairyVariant=901}
              $ocrLines.Add($label);$ocrLines.Add($amount);$pageLines.Add($label);$pageLines.Add($amount)
            }
          }catch{}
        }
      }
    }    # Peterborough Bazaar invoices print their authoritative VAT in a compact
    # `VAT Total` footer row. On the 5x retry, enlarge only that footer cell if
    # full-page OCR missed it; never substitute a product VAT rate or derive it.
    $peterboroughText=($pageLines.ToArray()|ForEach-Object{[string]$_.text}) -join ' '
    if(-not $bankRegion -and $Scale -ge 4.5 -and $peterboroughText -match 'Peterborough\s+Bazaar|pbazaar\.co\.uk|104\s*2318\s*66'){
      $footerVatLabels=@($pageLines.ToArray()|Where-Object{[string]$_.text -match '^\s*VAT\s+Total\s*:?\s*$' -and [double]$_.x -gt 1000 -and [double]$_.y -gt 1800})
      foreach($label in $footerVatLabels){
        $nearby=@($pageLines.ToArray()|Where-Object{$_.page -eq $label.page -and [math]::Abs([double]$_.y-[double]$label.y) -le 32 -and [double]$_.x -ge ([double]$label.x+140) -and [string]$_.text -match '\d'}|Sort-Object {[math]::Abs([double]$_.y-[double]$label.y)}|Select-Object -First 1)
        $alreadyReadable=$nearby.Count -and [string]$nearby[0].text -match '^\s*\d[\d\s,]*[.,]\s*\d{2}\s*$'
        if($alreadyReadable){continue}
        # Keep the printed label beside its value in the crop. Isolating the
        # digits alone can make Windows OCR drop a thin leading `1` (14.74 ->
        # 4.74); the row context lets OCR preserve the complete printed cell.
        $left=[math]::Max(0.0,[double]$label.x-35.0);$top=[math]::Max(0.0,[double]$label.y-20.0)
        try{
          $focusedBand=Read-EnhancedReceiptRegion $bitmap $Scale $left $top 520.0 58.0 $engine $page
          $moneyMatches=[regex]::Matches([string]$focusedBand.Text,'(?<!\d)(?:\d{1,3}(?:[ ,]\d{3})*|\d+)[.,]\s*\d{2}(?!\d)')
          $moneyValues=@($moneyMatches|ForEach-Object{$_.Value -replace '\s+',''}|Select-Object -Unique)
          if($moneyValues.Count -eq 1){
            $focusedVat=[string]$moneyValues[0]
            if($nearby.Count){$nearby[0].text=$focusedVat}
            else{$focusedLine=[pscustomobject]@{page=$index+1;text=$focusedVat;x=$left+300.0;y=[double]$label.y;width=130.0;height=30.0};$pageLines.Add($focusedLine);$ocrLines.Add($focusedLine)}
          }
        }catch{}
      }
    }
    # Shahid Halal Poultry's current invoice amount is the value beside the
    # footer TOTAL label. A pound glyph can be mistaken for a leading 2 (for
    # example £1,196.18 -> 21,196.18); when the parser flags that shape, retry
    # only that total cell at 5x and replace it only with a complete printed
    # amount. BALANCE and G TOTAL are deliberately outside this search.
    $shahidText=($pageLines.ToArray()|ForEach-Object{[string]$_.text}) -join ' '
    if(-not $bankRegion -and $Scale -ge 4.5 -and ($shahidText -match 'SHAH[I]D\s+HALAL\s+POULTRY|SHAHD\s+HALAL\s+POULTRY|SAAHID\s+HALAL\s+POULTRY|07973\s*658\s*417|159\s*5722\s*76')){
      $shahidTotalLabels=@($pageLines.ToArray()|Where-Object{[string]$_.text -match '^\s*TOTAL\s*:?\s*$' -and [double]$_.x -gt 850 -and [double]$_.y -gt 1900 -and [double]$_.y -lt 2700})
      foreach($label in $shahidTotalLabels){
        $amountCells=@($pageLines.ToArray()|Where-Object{$_.page -eq $label.page -and [math]::Abs([double]$_.y-[double]$label.y) -le 28 -and [double]$_.x -ge ([double]$label.x+100) -and [string]$_.text -match '\d'}|Sort-Object {[math]::Abs([double]$_.y-[double]$label.y)}|Select-Object -First 1)
        foreach($candidate in $amountCells){
          $raw=[string]$candidate.text
          if($raw -notmatch '^\s*2\d{1,2}\s*,\s*\d{3}[.,]\s*\d{2}\s*$'){continue}
          $rawDigits=[regex]::Replace($raw,'\D','');$expectedDigits=if($rawDigits.Length -gt 1){$rawDigits.Substring(1)}else{''}
          foreach($offset in @(24.0,34.0,44.0,54.0,64.0)){
            # Read past the fixed pound-sign position while keeping the full
            # number cell. This prevents the £ glyph from becoming a false
            # leading digit without dropping the first actual digit.
            $shifted=[pscustomobject]@{x=[double]$candidate.x+$offset;y=[double]$candidate.y;width=[math]::Max(70.0,[double]$candidate.width-$offset);height=[math]::Max(28.0,[double]$candidate.height)}
            try{$improved=[string](Read-EnhancedVatCell $bitmap $Scale $shifted $engine $page);$improvedDigits=[regex]::Replace($improved,'\D','');if($improved -match '^\s*\d[\d\s,]*[.,]\s*\d{2}\s*$' -and $improvedDigits -eq $expectedDigits){$candidate.text=$improved.Trim();$candidate|Add-Member -NotePropertyName shahidTotalVerified -NotePropertyValue $true -Force;break}}catch{}
          }
          if($candidate.shahidTotalVerified){break}
        }
      }
    }
    # Polish delivery notes print their document total in a bold, isolated
    # amount cell beside `Total` at the top of a summary page. On the 5x retry,
    # OCR that cell separately so a clear printed 223,26 is not left as an
    # ambiguous `22S,Ã¤6`. Only replace the original text when the focused scan
    # returns a complete amount with two decimal digits.
    if(-not $bankRegion -and $Scale -ge 4.5){
      $wzTotals=@($pageLines.ToArray()|Where-Object{[string]$_.text -match '^\s*total\s*$' -and [double]$_.y -lt 360})
      foreach($label in $wzTotals){
        $candidates=@($pageLines.ToArray()|Where-Object{$_.page -eq $label.page -and [math]::Abs([double]$_.y-[double]$label.y) -le 38 -and [double]$_.x -ge ([double]$label.x+180) -and [double]$_.x -lt 2050 -and ([string]$_.text).Length -le 16 -and [string]$_.text -match '\d' -and [string]$_.text -notmatch '[A-Za-z]{3,}'}|Sort-Object {[double]$_.x})
        foreach($candidate in $candidates){
          $raw=[string]$candidate.text
          if($raw -match '^\s*\d[\d\s]*[.,]\s*\d{2}\s*$'){continue}
          try{$improved=[string](Read-EnhancedVatCell $bitmap $Scale $candidate $engine $page);if($improved -match '^\s*\d[\d\s]*[.,]\s*\d{2}\s*$'){$candidate.text=$improved.Trim();break}}catch{}
          # At this point the value is already isolated beside the printed
          # Total label at 5x. Windows OCR can render a zero as O/Ã¶ and a
          # comma as a semicolon; normalize only that constrained money shape.
          if($raw -match '^\s*(\d{1,3})[OoQq\u00D6\u00F6][,.;]\s*(\d{2})\s*$'){$whole=$matches[1]+'0';$pennies=$matches[2];$candidate.text=$whole+'.'+$pennies;break}
        }
      }
    }
    # MFG fuel receipts can print extra shop items, followed by separate VAT
    # tables for Motor Fuel and the shop. The receipt's own Total is above
    # those tables. On faded scans Windows OCR may retain only the pennies
    # (for example `.26` from `Â£31.26`), so rescan that exact printed amount
    # cell from the 5x page render. Never derive the receipt total from the
    # separate supplier totals below it.
    if(-not $bankRegion -and $Scale -ge 4.5 -and @($pageLines.ToArray()|Where-Object{[string]$_.text -match '\b(?:MFG|MOTOR\s+FUEL)\b'}).Count -and @($pageLines.ToArray()|Where-Object{[string]$_.text -match '\b(?:UNLEADED|DIESEL)\b'}).Count){
      $mfgTotalLabels=@($pageLines.ToArray()|Where-Object{
        $labelText=[regex]::Replace([string]$_.text,'[^A-Za-z0-9]','').ToUpperInvariant()
        [double]$_.x -lt 300 -and [double]$_.y -gt 550 -and [double]$_.y -lt 1050 -and $labelText.Length -ge 4 -and $labelText.Length -le 7 -and $labelText.StartsWith('TO')
      })
      foreach($label in $mfgTotalLabels){
        $amountCells=@($pageLines.ToArray()|Where-Object{$_.page -eq $label.page -and [math]::Abs([double]$_.y-[double]$label.y) -le 32 -and [double]$_.x -ge ([double]$label.x+220) -and [double]$_.x -lt 900 -and [string]$_.text -match '\d'}|Sort-Object {[double]$_.x})
        foreach($candidate in $amountCells){
          if([string]$candidate.text -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*$'){break}
          $receiptAmountCell=[pscustomobject]@{x=[math]::Max(0.0,[double]$candidate.x-80.0);y=[double]$candidate.y;width=160.0;height=[double]$candidate.height}
          try{$improved=[string](Read-EnhancedVatCell $bitmap $Scale $receiptAmountCell $engine $page);if($improved -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*$'){$candidate.text=$improved.Trim();break}}catch{}
        }
      }
    }
    # Fuel receipts can lose the total line when the scan is faint or the OCR
    # joins its label to the amount (for example `TO r AL` and `€30.01`). On
    # the single high-resolution retry, rescan the compact receipt-total band
    # beside the pump line and retain its original page coordinates.
    if(-not $bankRegion -and $Scale -ge 4.5){
      $fuelRows=@($pageLines.ToArray()|Where-Object{$fuelText=([regex]::Replace([string]$_.text,'[^A-Za-z0-9]','')).ToUpperInvariant();$fuelText -match 'UN[I1]?LEADED|DIESEL|PETROL' -and $fuelText -notmatch 'PETROLEUM'}|Sort-Object {[double]$_.y})
      if($fuelRows.Count){$fuelY=[double]$fuelRows[0].y;$focus=Read-EnhancedReceiptRegion $bitmap $Scale 0 ($fuelY+70) 800 200 $engine $page;if($focus.Text){$parts.Add($focus.Text);foreach($line in $focus.Lines){$line.page=$index+1;$pageLines.Add($line);$ocrLines.Add($line)}}
        $totalCell=[pscustomobject]@{x=400.0;y=$fuelY+105.0;width=400.0;height=65.0};try{$printedTotal=[string](Read-EnhancedVatCell $bitmap $Scale $totalCell $engine $page);if($printedTotal -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\D?\s*$'){$focusedAmount=[pscustomobject]@{page=$index+1;text=$printedTotal.Trim();x=500.0;y=$fuelY+135.0;width=130.0;height=28.0};$pageLines.Add($focusedAmount);$ocrLines.Add($focusedAmount)}}catch{}
        # When whole-page OCR retains only the last penny digits, focus each
        # amount-sized cell in the transaction total band instead of reusing
        # a pump price or the VAT-summary numbers below it.
        $amountCells=@($pageLines.ToArray()|Where-Object{$dy=[double]$_.y-$fuelY;$raw=[string]$_.text;$dy -ge 90 -and $dy -le 260 -and [double]$_.x -ge 450 -and [double]$_.x -lt 1000 -and $raw.Length -le 28 -and $raw -match '[0-9OoIl]' -and $raw -notmatch '\b(?:AID|AUTH|MERCHANT|TERMINAL|CHANGE|NUMBER|PAN|SEQ|PUMP|LITRE|LITER)\b'}|Sort-Object {[math]::Abs(([double]$_.y-$fuelY)-145)}|Select-Object -First 2)
        foreach($candidate in $amountCells){$raw=[string]$candidate.text;if($raw -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\D?\s*$'){continue};try{$improved=[string](Read-EnhancedVatCell $bitmap $Scale $candidate $engine $page);if($improved -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\D?\s*$'){$candidate.text=$improved.Trim()}}catch{}}
      }
      # Re-read printed dates in a small surrounding band. Some tills place
      # the date beside a CUSTOMER RECEIPT heading; others put it above COPY.
      $dateRegions=New-Object System.Collections.Generic.List[object]
      $dateCandidates=@($pageLines.ToArray()|Where-Object{$_.y -gt 240 -and $_.y -lt 2300 -and [string]$_.text -match '20\d{2}|\d{1,2}\s*[./:-]\s*\d{1,2}|\b(?:DATE|TIME)\b'}|Sort-Object {[double]$_.y})
      foreach($candidate in $dateCandidates){if($dateRegions.Count -ge 2){break};$top=[math]::Max(0.0,[double]$candidate.y-34.0);if(@($dateRegions|Where-Object{[math]::Abs([double]$_.Top-$top) -lt 70}).Count){continue};$dateRegions.Add([pscustomobject]@{Left=0.0;Top=$top;Width=800.0;Height=88.0})}
      $receiptHeader=@($pageLines.ToArray()|Where-Object{[string]$_.text -match '\bCUSTOMER\s+(?:RECEIPT|COPY)\b|\bCOPY\s+RECEIPT\b|^\s*COPY\s*$'}|Sort-Object {[double]$_.y}|Select-Object -First 1)
      if($receiptHeader.Count){$headerText=[string]$receiptHeader[0].text;$top=if($headerText -match 'RECEIPT' -and $headerText -notmatch 'COPY'){[double]$receiptHeader[0].y+72.0}else{[double]$receiptHeader[0].y-96.0};if($top -ge 0 -and -not @($dateRegions|Where-Object{[math]::Abs([double]$_.Top-$top) -lt 70}).Count){$dateRegions.Add([pscustomobject]@{Left=0.0;Top=$top;Width=800.0;Height=100.0})}}
      foreach($region in $dateRegions){$focusedDate=Read-EnhancedReceiptRegion $bitmap $Scale $region.Left $region.Top $region.Width $region.Height $engine $page;if($focusedDate.Text){$parts.Add($focusedDate.Text);foreach($line in $focusedDate.Lines){$line.page=$index+1;$pageLines.Add($line);$ocrLines.Add($line)}}}
      # Some Shell slips lose the pump and total labels during whole-page OCR,
      # while retaining the VAT ANALYSIS heading. The receipt total is printed
      # immediately above that heading, so isolate that band on the single 5x
      # retry instead of falling back to a net/VAT calculation.
      $pageText=($pageLines.ToArray()|ForEach-Object{[string]$_.text}) -join ' '
      if($pageText -match 'SHELL|SHEE|MASTERCARD|MASTIAERCARO|\bEFT\b|\bFUEL\b'){
        $analysisLabels=@($pageLines.ToArray()|Where-Object{[string]$_.text -match 'ANALYSIS' -and [double]$_.y -gt 400 -and [double]$_.y -lt 1100}|Sort-Object {[double]$_.y}|Select-Object -First 1)
        if($analysisLabels.Count){
          $top=[math]::Max(0.0,[double]$analysisLabels[0].y-130.0);$focusedTotal=Read-EnhancedReceiptRegion $bitmap $Scale 0 $top 800 92 $engine $page
          if($focusedTotal.Text){$parts.Add($focusedTotal.Text);foreach($line in $focusedTotal.Lines){$line.page=$index+1;$pageLines.Add($line);$ocrLines.Add($line)}}
          $amountCell=[pscustomobject]@{x=600.0;y=$top+60.0;width=220.0;height=48.0}
          try{$printedTotal=[string](Read-EnhancedVatCell $bitmap $Scale $amountCell $engine $page);if($printedTotal -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\D?\s*$'){$focusedAmount=[pscustomobject]@{page=$index+1;text=$printedTotal.Trim();x=580.0;y=$top+80.0;width=230.0;height=32.0};$pageLines.Add($focusedAmount);$ocrLines.Add($focusedAmount)}}catch{}
        }
      }
      if($pageText -match 'SHELL|SHEE|SHEL|GO\+'){
        $paymentRegion=Read-EnhancedReceiptRegion $bitmap $Scale 0 1760 800 300 $engine $page
        if($paymentRegion.Text){$parts.Add($paymentRegion.Text);foreach($line in $paymentRegion.Lines){$line.page=$index+1;$pageLines.Add($line);$ocrLines.Add($line)}}
        $amountLabels=@($pageLines.ToArray()|Where-Object{[string]$_.text -match '^\s*AMOUNT\s*$'}|Sort-Object {[double]$_.y}|Select-Object -First 1)
        foreach($label in $amountLabels){
          $amountCells=@($pageLines.ToArray()|Where-Object{[math]::Abs([double]$_.y-[double]$label.y) -le 45 -and [double]$_.x -ge ([double]$label.x+180) -and [string]$_.text -match '\d'}|Sort-Object {[double]$_.x}|Select-Object -First 1)
          foreach($candidate in $amountCells){
            try{$left=[math]::Max(0.0,[double]$candidate.x-35.0);$improved=[string](Read-EnhancedVatCell $bitmap $Scale ([pscustomobject]@{x=$left;y=[double]$candidate.y;width=150.0;height=[math]::Max(32.0,[double]$candidate.height+8.0)}) $engine $page);if($improved -match '^\s*\D?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\D?\s*$'){$focusedAmount=[pscustomobject]@{page=$index+1;text=$improved.Trim();x=$left;y=[double]$candidate.y;width=150.0;height=32.0};$pageLines.Add($focusedAmount);$ocrLines.Add($focusedAmount)}}catch{}
          }
        }
      }
    }
    [Console]::WriteLine('PAGE:'+(@{page=$index+1;pageCount=$pdf.PageCount;ocrLanguage=$ocrLanguage;text=$result.Text;lines=$pageLines.ToArray()}|ConvertTo-Json -Compress -Depth 5))
    $bitmap.Dispose();$result=$null;$decoder=$null;$stream.Dispose();$page.Dispose();$processedPageCount++
    if($processedPageCount%3 -eq 0){[GC]::Collect();[GC]::WaitForPendingFinalizers()}
  }
  [pscustomobject]@{ok=$true;pages=$pdf.PageCount;ocrLanguage=$ocrLanguage;text=($parts -join "`n");lines=$ocrLines;visualPages=$visualPages.ToArray()} | ConvertTo-Json -Compress -Depth 5
} catch {
  [pscustomobject]@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress
  exit 1
}


