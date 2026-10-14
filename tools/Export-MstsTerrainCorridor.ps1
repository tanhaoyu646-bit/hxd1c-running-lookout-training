param(
    [Parameter(Mandatory = $true)]
    [string]$GameRoot,

    [Parameter(Mandatory = $true)]
    [string]$RouteName,

    [string]$Tiles = 'n5742_14700;n5742_14701;n5741_14701;n5741_14702;n5740_14701;n5740_14702;n5739_14702;n5738_14702',

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [int]$Resolution = 65,
    [double]$OriginX = 604.624,
    [double]$OriginY = 1289.16,
    [double]$OriginZ = -775.032,
    [int]$OriginTileX = -5742,
    [int]$OriginTileZ = 14701
)

$ErrorActionPreference = 'Stop'
if ($Resolution -lt 3) { throw 'Resolution must be at least 3' }

$openRailsRoot = Join-Path $GameRoot 'ORDP6063'
$routeRoot = Join-Path (Join-Path $GameRoot 'ROUTES') $RouteName
$tileRoot = Join-Path $routeRoot 'TILES'
$formatsAssembly = Join-Path $openRailsRoot 'Orts.Formats.Msts.dll'

[Environment]::CurrentDirectory = $openRailsRoot
Get-ChildItem -LiteralPath $openRailsRoot -Filter '*.dll' | ForEach-Object {
    try { [Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch { }
}

$formats = [Reflection.Assembly]::LoadFrom($formatsAssembly)
$tileNameType = $formats.GetType('Orts.Formats.Msts.TileName', $true)
$tileZoomType = $formats.GetType('Orts.Formats.Msts.TileName+Zoom', $true)
$terrainType = $formats.GetType('Orts.Formats.Msts.TerrainFile', $true)
$altitudeType = $formats.GetType('Orts.Formats.Msts.TerrainAltitudeFile', $true)
$smallZoom = [Enum]::Parse($tileZoomType, 'Small')

$tileResults = New-Object System.Collections.Generic.List[object]
foreach ($rawTileSpec in @([string]$Tiles -split '[,;]')) {
    $tileSpec = ([string]$rawTileSpec).Trim().Trim("'").Trim('"')
    if (-not $tileSpec) { continue }
    $separatorIndex = $tileSpec.IndexOf('_')
    if ($separatorIndex -lt 0) { $separatorIndex = $tileSpec.IndexOf(':') }
    if ($separatorIndex -lt 1 -or $separatorIndex -ge $tileSpec.Length - 1) { throw "Invalid tile coordinate: $tileSpec" }
    $tileXText = $tileSpec.Substring(0, $separatorIndex)
    $tileX = if ($tileXText.StartsWith('n')) { -[int]$tileXText.Substring(1) } else { [int]$tileXText }
    $tileZ = [int]$tileSpec.Substring($separatorIndex + 1)
    $baseName = [string]$tileNameType.GetMethod('FromTileXZ').Invoke($null, @($tileX, $tileZ, $smallZoom))
    $terrainPath = Join-Path $tileRoot ($baseName.ToLowerInvariant() + '.t')
    if (-not (Test-Path -LiteralPath $terrainPath)) { throw "Terrain tile not found: $terrainPath" }

    $terrainFile = [Activator]::CreateInstance($terrainType, @([string]$terrainPath))
    $samples = $terrainFile.terrain.terrain_samples
    $altitudePath = Join-Path $tileRoot ([string]$samples.terrain_sample_ybuffer)
    $altitudeFile = [Activator]::CreateInstance($altitudeType, @([string]$altitudePath, [int]$samples.terrain_nsamples))
    $heights = New-Object System.Collections.Generic.List[double]
    for ($row = 0; $row -lt $Resolution; $row++) {
        $sampleZ = [Math]::Min([int]$samples.terrain_nsamples - 1, [Math]::Round($row * ([int]$samples.terrain_nsamples - 1) / ($Resolution - 1)))
        for ($column = 0; $column -lt $Resolution; $column++) {
            $sampleX = [Math]::Min([int]$samples.terrain_nsamples - 1, [Math]::Round($column * ([int]$samples.terrain_nsamples - 1) / ($Resolution - 1)))
            $raw = $altitudeFile.GetElevation($sampleX, $sampleZ)
            $height = [double]$samples.terrain_sample_floor + [double]$samples.terrain_sample_scale * $raw - $OriginY
            $heights.Add([Math]::Round($height, 3))
        }
    }

    $tileResults.Add([pscustomobject][ordered]@{
        tileX = $tileX
        tileZ = $tileZ
        tileName = $baseName.ToLowerInvariant()
        terrainPath = $terrainPath
        terrainSha256 = (Get-FileHash -LiteralPath $terrainPath -Algorithm SHA256).Hash
        altitudePath = $altitudePath
        altitudeSha256 = (Get-FileHash -LiteralPath $altitudePath -Algorithm SHA256).Hash
        sampleSize = [double]$samples.terrain_sample_size
        resolution = $Resolution
        heights = $heights.ToArray()
    })
}

$result = [ordered]@{
    format = 'msts-terrain-corridor-v1'
    source = [ordered]@{
        route = $RouteName
        origin = @($OriginX, $OriginY, $OriginZ)
        originTile = @($OriginTileX, $OriginTileZ)
        tileSize = 2048
        coordinateTransform = 'three = (-mstsX, mstsY, mstsZ); relative to origin'
    }
    summary = [ordered]@{
        tileCount = $tileResults.Count
        resolution = $Resolution
    }
    tiles = $tileResults.ToArray()
}

$json = $result | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText($OutputPath, $json, [Text.UTF8Encoding]::new($false))
Write-Output "Exported $($tileResults.Count) terrain tiles at ${Resolution}x${Resolution} to $OutputPath"
