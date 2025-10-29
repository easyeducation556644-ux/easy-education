import { useState } from "react"
import { 
  Download, 
  FileText, 
  Image as ImageIcon, 
  X, 
  ExternalLink, 
  Maximize2, 
  Minimize2, 
  Printer,
  Copy,
  CheckCircle,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Loader2,
  AlertCircle
} from "lucide-react"
import { toast } from "sonner"

export default function ResourceViewer({ resource }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  if (!resource || !resource.url) return null

  const extractGoogleDriveFileId = (url) => {
    const patterns = [
      /\/file\/d\/([^\/]+)/,
      /id=([^&]+)/,
      /\/d\/([^\/]+)/,
    ]
    
    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }
    return null
  }

  const isGoogleDriveLink = (url) => {
    return url.includes('drive.google.com') || url.includes('docs.google.com')
  }

  const isPDFLink = (url) => {
    const urlLower = url.toLowerCase()
    return urlLower.endsWith('.pdf') || urlLower.includes('.pdf?')
  }

  const getProcessedUrls = (url) => {
    if (isGoogleDriveLink(url)) {
      const fileId = extractGoogleDriveFileId(url)
      if (fileId) {
        return {
          preview: `https://drive.google.com/file/d/${fileId}/preview`,
          download: `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
          isGoogleDrive: true,
          fileId: fileId
        }
      }
    }
    
    return {
      preview: url,
      download: url,
      isGoogleDrive: false
    }
  }

  const getFileType = (url) => {
    const urlLower = url.toLowerCase()
    if (isPDFLink(url)) return 'pdf'
    if (isGoogleDriveLink(url)) return 'google-drive'
    if (urlLower.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)/)) return 'image'
    return 'unknown'
  }

  const fileType = getFileType(resource.url)
  const { preview, download, isGoogleDrive, fileId } = getProcessedUrls(resource.url)
  const isDirectPDF = fileType === 'pdf' && !isGoogleDrive

  const handleAutoDownload = async () => {
    setIsDownloading(true)
    try {
      const a = document.createElement('a')
      a.href = download
      a.download = resource.label || 'download'
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      
      toast.success('ডাউনলোড শুরু হয়েছে!', {
        description: isGoogleDrive ? 'Google Drive থেকে ফাইল ডাউনলোড হচ্ছে...' : 'ফাইল ডাউনলোড হচ্ছে...'
      })
    } catch (error) {
      console.error('Download failed:', error)
      toast.error('ডাউনলোড ব্যর্থ হয়েছে', {
        description: 'আবার চেষ্টা করুন'
      })
    } finally {
      setIsDownloading(false)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(resource.url)
    setCopied(true)
    toast.success('লিংক কপি হয়েছে!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handlePrint = () => {
    if (isDirectPDF) {
      const printWindow = window.open(preview, '_blank')
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print()
        }
        toast.success('প্রিন্ট উইন্ডো খোলা হচ্ছে...')
      }
    } else {
      toast.info('এই ফাইলটি সরাসরি প্রিন্ট করা যাবে না। নতুন ট্যাবে খুলে প্রিন্ট করুন।')
    }
  }

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
  }

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 25, 200))
  }

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 25, 50))
  }

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360)
  }

  const handleOpenInNewTab = () => {
    window.open(preview, '_blank', 'noopener,noreferrer')
    toast.success('নতুন ট্যাবে খোলা হচ্ছে...')
  }

  if (fileType === 'unknown') {
    return (
      <div className="space-y-2">
        <button
          onClick={handleAutoDownload}
          disabled={isDownloading}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-all border border-primary/20 hover:border-primary/40 font-medium text-sm group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDownloading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          <span>{resource.label}</span>
          <Download className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-all border border-primary/20 hover:border-primary/40 font-medium text-sm group w-full sm:w-auto justify-center sm:justify-start hover:shadow-md"
      >
        {fileType === 'pdf' || fileType === 'google-drive' ? (
          <FileText className="w-4 h-4" />
        ) : (
          <ImageIcon className="w-4 h-4" />
        )}
        <span>{resource.label}</span>
        {isOpen ? (
          <X className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
        ) : (
          <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
        )}
      </button>

      {isOpen && (
        <div 
          className={`bg-card border-2 border-primary/20 rounded-xl overflow-hidden shadow-xl transition-all duration-300 ${
            isFullscreen ? 'fixed inset-4 z-50' : ''
          }`}
        >
          <div className="bg-gradient-to-r from-primary/10 to-primary/5 px-4 py-3 flex items-center justify-between border-b border-primary/20">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              {fileType === 'pdf' || fileType === 'google-drive' ? (
                <FileText className="w-4 h-4 text-primary" />
              ) : (
                <ImageIcon className="w-4 h-4 text-primary" />
              )}
              <span className="line-clamp-1">{resource.label}</span>
            </h3>
            
            <div className="flex items-center gap-1.5">
              {isDirectPDF && (
                <>
                  <button
                    onClick={handleZoomOut}
                    className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs px-2 py-1 bg-muted rounded-md font-medium min-w-[3.5rem] text-center">
                    {zoom}%
                  </span>
                  <button
                    onClick={handleZoomIn}
                    className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <div className="w-px h-4 bg-border mx-1" />
                </>
              )}
              
              {fileType === 'image' && (
                <>
                  <button
                    onClick={handleRotate}
                    className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                    title="Rotate"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <div className="w-px h-4 bg-border mx-1" />
                </>
              )}
              
              <button
                onClick={handleCopyLink}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                title="Copy Link"
              >
                {copied ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              
              {(isDirectPDF || fileType === 'google-drive') && (
                <button
                  onClick={handlePrint}
                  className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                  title="Print"
                >
                  <Printer className="w-4 h-4" />
                </button>
              )}
              
              <button
                onClick={handleOpenInNewTab}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                title="Open in New Tab"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              
              <button
                onClick={toggleFullscreen}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
              
              <div className="w-px h-4 bg-border mx-1" />
              
              <button
                onClick={handleAutoDownload}
                disabled={isDownloading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title="Download"
              >
                {isDownloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">ডাউনলোড</span>
              </button>
              
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-muted/30 relative">
            {isLoading && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">লোড হচ্ছে...</p>
                </div>
              </div>
            )}

            {loadError && (
              <div className="flex items-center justify-center p-8 min-h-[400px]">
                <div className="flex flex-col items-center gap-4 max-w-md text-center">
                  <AlertCircle className="w-16 h-16 text-destructive/70" />
                  <div>
                    <h4 className="font-semibold text-lg mb-2">ফাইল লোড করতে সমস্যা হচ্ছে</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      Preview সঠিকভাবে লোড হচ্ছে না। সরাসরি ডাউনলোড করুন অথবা নতুন ট্যাবে খুলুন।
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleAutoDownload}
                      disabled={isDownloading}
                      className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      {isDownloading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      ডাউনলোড করুন
                    </button>
                    <button
                      onClick={handleOpenInNewTab}
                      className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors text-sm font-medium"
                    >
                      <ExternalLink className="w-4 h-4" />
                      নতুন ট্যাবে খুলুন
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!loadError && (
              <>
                {fileType === 'pdf' && isDirectPDF ? (
                  <div 
                    className="overflow-auto"
                    style={{ 
                      height: isFullscreen ? 'calc(100vh - 8rem)' : '500px',
                      maxHeight: isFullscreen ? 'calc(100vh - 8rem)' : '600px'
                    }}
                  >
                    <iframe
                      src={`${preview}#zoom=${zoom}&toolbar=1&navpanes=1&scrollbar=1`}
                      className="w-full h-full border-0"
                      title={resource.label}
                      onLoad={() => setIsLoading(false)}
                      onError={() => {
                        setIsLoading(false)
                        setLoadError(true)
                      }}
                      style={{
                        minHeight: isFullscreen ? 'calc(100vh - 8rem)' : '500px'
                      }}
                    />
                  </div>
                ) : fileType === 'google-drive' ? (
                  <div 
                    className="overflow-auto"
                    style={{ 
                      height: isFullscreen ? 'calc(100vh - 8rem)' : '500px',
                      maxHeight: isFullscreen ? 'calc(100vh - 8rem)' : '600px'
                    }}
                  >
                    <iframe
                      src={preview}
                      className="w-full h-full border-0"
                      title={resource.label}
                      onLoad={() => setIsLoading(false)}
                      onError={() => {
                        setIsLoading(false)
                        setLoadError(true)
                      }}
                      style={{
                        minHeight: isFullscreen ? 'calc(100vh - 8rem)' : '500px'
                      }}
                      allow="autoplay"
                    />
                  </div>
                ) : fileType === 'image' ? (
                  <div className="p-4 flex items-center justify-center" style={{ 
                    minHeight: isFullscreen ? 'calc(100vh - 8rem)' : '400px'
                  }}>
                    <img
                      src={preview}
                      alt={resource.label}
                      className="max-w-full h-auto rounded-lg shadow-lg transition-transform duration-300"
                      style={{
                        transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                        maxHeight: isFullscreen ? 'calc(100vh - 10rem)' : '500px'
                      }}
                      onLoad={() => setIsLoading(false)}
                      onError={() => {
                        setIsLoading(false)
                        setLoadError(true)
                      }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>

          {isGoogleDrive && fileId && !loadError && (
            <div className="bg-primary/5 px-4 py-2 border-t border-primary/20 flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                Google Drive File
              </span>
              <a
                href={`https://drive.google.com/file/d/${fileId}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline flex items-center gap-1"
              >
                Google Drive-এ দেখুন
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
