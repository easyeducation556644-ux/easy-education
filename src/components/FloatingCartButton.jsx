

import { motion, AnimatePresence } from "framer-motion"
import { ShoppingCart } from "lucide-react"
import { useCart } from "../contexts/CartContext"

export default function FloatingCartButton() {
  const { cartItems, openCart } = useCart()
  const itemCount = cartItems.length

  return (
    <motion.button
      onClick={openCart}
      className="fixed bottom-6 right-6 z-40 p-3 sm:p-4 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl smooth-transition flex items-center justify-center group"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label="Open cart"
    >
      <ShoppingCart className="w-5 h-5 sm:w-6 sm:h-6" />

      <AnimatePresence>
        {itemCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-2 -right-2 w-5 h-5 sm:w-6 sm:h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-lg"
          >
            {itemCount}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tooltip on desktop */}
      <div className="hidden md:block absolute right-full mr-3 px-3 py-2 bg-gray-900 dark:bg-gray-800 text-white text-sm rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        View Cart
      </div>
    </motion.button>
  )
}
