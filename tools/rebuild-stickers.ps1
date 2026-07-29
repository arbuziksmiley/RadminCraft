param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class StickerRebuilder {
  private sealed class Component {
    public readonly List<int> Pixels = new List<int>();
    public int MinX = int.MaxValue, MinY = int.MaxValue, MaxX = -1, MaxY = -1;
    public bool TouchesEdge;
  }

  public static void Rebuild(string sheetPath, string outputDir, int firstIndex) {
    using (var sheet = new Bitmap(sheetPath)) {
      int cellWidth = sheet.Width / 5;
      int cellHeight = sheet.Height / 5;
      for (int row = 0; row < 5; row++) {
        for (int column = 0; column < 5; column++) {
          int index = firstIndex + row * 5 + column;
          using (var cell = sheet.Clone(new Rectangle(column * cellWidth, row * cellHeight, cellWidth, cellHeight), PixelFormat.Format32bppArgb)) {
            using (var isolated = IsolateSticker(cell)) {
              string target = Path.Combine(outputDir, "mc-" + index.ToString("00") + ".png");
              isolated.Save(target, ImageFormat.Png);
            }
          }
        }
      }
    }
  }

  private static Bitmap IsolateSticker(Bitmap input) {
    int width = input.Width, height = input.Height;
    bool[] opaque = new bool[width * height];
    for (int y = 0; y < height; y++)
      for (int x = 0; x < width; x++)
        opaque[y * width + x] = input.GetPixel(x, y).A > 12;

    bool[] visited = new bool[opaque.Length];
    var components = new List<Component>();
    int[] queue = new int[opaque.Length];
    int[] dx = { -1, 0, 1, -1, 1, -1, 0, 1 };
    int[] dy = { -1, -1, -1, 0, 0, 1, 1, 1 };
    for (int start = 0; start < opaque.Length; start++) {
      if (!opaque[start] || visited[start]) continue;
      var component = new Component();
      int head = 0, tail = 0; queue[tail++] = start; visited[start] = true;
      while (head < tail) {
        int pixel = queue[head++], x = pixel % width, y = pixel / width;
        component.Pixels.Add(pixel);
        component.MinX = Math.Min(component.MinX, x); component.MaxX = Math.Max(component.MaxX, x);
        component.MinY = Math.Min(component.MinY, y); component.MaxY = Math.Max(component.MaxY, y);
        if (x == 0 || y == 0 || x == width - 1 || y == height - 1) component.TouchesEdge = true;
        for (int direction = 0; direction < 8; direction++) {
          int nx = x + dx[direction], ny = y + dy[direction];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          int next = ny * width + nx;
          if (opaque[next] && !visited[next]) { visited[next] = true; queue[tail++] = next; }
        }
      }
      components.Add(component);
    }

    Component largest = null;
    foreach (var component in components)
      if (largest == null || component.Pixels.Count > largest.Pixels.Count) largest = component;

    var kept = new HashSet<int>();
    foreach (var component in components) {
      bool isDecoration = !component.TouchesEdge && component.Pixels.Count >= 18;
      if (component == largest || isDecoration) foreach (int pixel in component.Pixels) kept.Add(pixel);
    }

    int minX = width, minY = height, maxX = -1, maxY = -1;
    foreach (int pixel in kept) {
      int x = pixel % width, y = pixel / width;
      minX = Math.Min(minX, x); minY = Math.Min(minY, y); maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y);
    }
    if (maxX < minX || maxY < minY) return new Bitmap(160, 160, PixelFormat.Format32bppArgb);

    using (var clean = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      foreach (int pixel in kept) {
        int x = pixel % width, y = pixel / width;
        clean.SetPixel(x, y, input.GetPixel(x, y));
      }
      var output = new Bitmap(160, 160, PixelFormat.Format32bppArgb);
      using (Graphics graphics = Graphics.FromImage(output)) {
        graphics.Clear(Color.Transparent);
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.CompositingQuality = CompositingQuality.HighQuality;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        int sourceWidth = maxX - minX + 1, sourceHeight = maxY - minY + 1;
        double scale = Math.Min(144.0 / sourceWidth, 144.0 / sourceHeight);
        int targetWidth = Math.Max(1, (int)Math.Round(sourceWidth * scale));
        int targetHeight = Math.Max(1, (int)Math.Round(sourceHeight * scale));
        int targetX = (160 - targetWidth) / 2, targetY = (160 - targetHeight) / 2;
        graphics.DrawImage(clean, new Rectangle(targetX, targetY, targetWidth, targetHeight), new Rectangle(minX, minY, sourceWidth, sourceHeight), GraphicsUnit.Pixel);
      }
      return output;
    }
  }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
$assetRoot = Join-Path $ProjectRoot 'src\assets\stickers'
$outputDir = Join-Path $assetRoot 'static'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
[StickerRebuilder]::Rebuild((Join-Path $ProjectRoot 'tools\source-assets\emotion-pack-sheet-1-alpha.png'), $outputDir, 0)
[StickerRebuilder]::Rebuild((Join-Path $ProjectRoot 'tools\source-assets\emotion-pack-sheet-2-alpha.png'), $outputDir, 25)
Write-Output "Rebuilt 50 sticker assets in $outputDir"
