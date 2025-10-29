import { Link } from "react-router-dom"
import { Send, Youtube, MessageCircle, Mail, Phone } from "lucide-react"

export default function Footer() {
  return (
    <footer className="bg-card border-t border-border mt-auto">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <h3 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-4">
              Easy Education
            </h3>
            <p className="text-muted-foreground text-sm">
              HSC academic & admissiozn courses  at low price.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4">Quick Links</h4>
            <div className="flex flex-col gap-2">
              <Link to="/" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                Home
              </Link>
              <Link to="/courses" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                Courses
              </Link>
              <Link to="/community" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                Community 
              </Link>
              <Link to="/announcements" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                Announcements
              </Link>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold mb-4">Contact</h4>
            <div className="flex flex-col gap-2">
              <a
                href="mailto:easyeducation556644@gmail.com"
                className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2"
              >
                <Mail className="w-4 h-4" /> easyeducation556644@gmail.com
              </a>
              <a
                href="tel:+8801969752197"
                className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2"
              >
                <Phone className="w-4 h-4" />
                +8801969752197
              </a>
              <a
                href="https://t.me/Chatbox67_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                Support Bot
              </a>
              <a
                href="https://t.me/eesupport01"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Support ID
              </a>
                           
              <a
                href="https://t.me/Easy_Education_01"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Telegram
              </a> 

            </div>
          </div>
          
           <div>
            <h4 className="font-semibold mb-4 ml-2">Follow Us</h4>
            <div className="flex flex-col gap-2">

<a
              href = "https://youtube.com/@easyeducation19"
              target = "_blank"
              rel = "noopener noreferrer"
              className = "text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2" >
                <Youtube className="w-4 h-4" />
              YouTube 01
                </a>
                <a
              href = "https://youtube.com/@easyeducation-01"
              target = "_blank"
              rel = "noopener noreferrer"
              className = "text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2" >
                <Youtube className="w-4 h-4" />
              YouTube 02
                </a>
            </div>
          </div>
          
        </div>
        
        
          
        </div>

        <div className="mt-8 pt-8 border-t border-border text-center text-muted-foreground text-sm grid grid-2">
          <p>Easy Education © All rights reserved</p>
          <p>Developed by: <a href= "https://t.me/hermanoMayorBot">Hermano Mayor</a></p>
        </div>
      
      
      
    </footer>
  )
}
