import { MapPin, ExternalLink, Globe, Building2, Navigation } from 'lucide-react'

export function DeviceLocationMap({ latitude, longitude, city, country, countryCode, region, district, postalCode, ip, isp, organization }) {
  const hasValidLocation = latitude && longitude && latitude !== 0 && longitude !== 0

  if (!hasValidLocation) {
    return (
      <div className="w-full bg-muted rounded-lg flex items-center justify-center p-6">
        <MapPin className="w-12 h-12 text-muted-foreground mb-2 mx-auto" />
        <p className="text-sm text-muted-foreground">Location data not available</p>
      </div>
    )
  }

  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`
  
  return (
    <div className="w-full bg-card rounded-lg border border-border overflow-hidden">
      <div className="p-3 md:p-4 bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-b border-border">
        <h4 className="font-semibold text-sm md:text-base mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
          IP Location via IP2Location
        </h4>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 text-xs md:text-sm">
          {ip && (
            <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
              <div className="w-6 h-6 flex items-center justify-center bg-red-500/20 rounded">
                <MapPin className="w-3 h-3 md:w-4 md:h-4 text-red-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">IP:</div>
                <div className="font-medium truncate">{ip}</div>
              </div>
            </div>
          )}
          
          {country && (
            <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
              <div className="w-6 h-6 flex items-center justify-center bg-green-500/20 rounded">
                <Globe className="w-3 h-3 md:w-4 md:h-4 text-green-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">Country:</div>
                <div className="font-medium truncate">{country}</div>
              </div>
            </div>
          )}
          
          {countryCode && (
            <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
              <div className="w-6 h-6 flex items-center justify-center bg-purple-500/20 rounded">
                <span className="text-xs font-bold text-purple-500">{countryCode}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">Country ISO:</div>
                <div className="font-medium">{countryCode}</div>
              </div>
            </div>
          )}
          
          {region && (
            <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
              <div className="w-6 h-6 flex items-center justify-center bg-orange-500/20 rounded">
                <Building2 className="w-3 h-3 md:w-4 md:h-4 text-orange-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">State/Region:</div>
                <div className="font-medium truncate">{region}</div>
              </div>
            </div>
          )}
          
          {city && (
            <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
              <div className="w-6 h-6 flex items-center justify-center bg-cyan-500/20 rounded">
                <span className="text-xs">🏙️</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">City:</div>
                <div className="font-medium truncate">{city}</div>
              </div>
            </div>
          )}
          
          {postalCode && (
            <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
              <div className="w-6 h-6 flex items-center justify-center bg-blue-500/20 rounded">
                <span className="text-xs">📮</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">Postal Code:</div>
                <div className="font-medium">{postalCode}</div>
              </div>
            </div>
          )}
          
          <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
            <div className="w-6 h-6 flex items-center justify-center bg-red-500/20 rounded">
              <span className="text-xs">🌐</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-muted-foreground text-xs">Latitude:</div>
              <div className="font-medium font-mono text-xs md:text-sm">{latitude.toFixed(5)}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
            <div className="w-6 h-6 flex items-center justify-center bg-red-500/20 rounded">
              <span className="text-xs">🧭</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-muted-foreground text-xs">Longitude:</div>
              <div className="font-medium font-mono text-xs md:text-sm">{longitude.toFixed(5)}</div>
            </div>
          </div>
          
          {(isp || organization) && (
            <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2 sm:col-span-2">
              <div className="w-6 h-6 flex items-center justify-center bg-yellow-500/20 rounded">
                <Navigation className="w-3 h-3 md:w-4 md:h-4 text-yellow-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">ISP/Organization:</div>
                <div className="font-medium truncate">{isp || organization}</div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="p-3 md:p-4">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-3 md:px-4 py-2 md:py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors text-xs md:text-sm font-medium"
        >
          <MapPin className="w-3 h-3 md:w-4 md:h-4" />
          <span className="hidden sm:inline">📍 View Map</span>
          <span className="sm:hidden">View Map</span>
          <ExternalLink className="w-3 h-3 md:w-4 md:h-4" />
        </a>
      </div>
    </div>
  )
}
