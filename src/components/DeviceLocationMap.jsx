import { MapPin, ExternalLink } from 'lucide-react'

export function DeviceLocationMap({ latitude, longitude, city, country, region, district, thana }) {
  const hasValidLocation = latitude && longitude && latitude !== 0 && longitude !== 0

  if (!hasValidLocation) {
    return (
      <div className="w-full bg-muted rounded-lg flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Location data not available</p>
      </div>
    )
  }

  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`
  
  const locationParts = [
    thana,
    district,
    region,
    city,
    country
  ].filter(Boolean)

  return (
    <div className="w-full bg-muted rounded-lg border border-border overflow-hidden">
      <div className="p-4 bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-b border-border">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <MapPin className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-foreground mb-1">Device Location</h4>
            {locationParts.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {locationParts.join(' • ')}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {latitude.toFixed(6)}, {longitude.toFixed(6)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground font-mono">
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </p>
            )}
          </div>
        </div>
      </div>
      
      <div className="p-4">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium"
        >
          <MapPin className="w-4 h-4" />
          Open in Google Maps
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  )
}
