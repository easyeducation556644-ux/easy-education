import { motion, AnimatePresence } from "framer-motion"
import { X, ShoppingCart, Trash2, ArrowRight } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useCart } from "../contexts/CartContext"

export default function CartDrawer() {
  const navigate = useNavigate()
  const { cartItems, removeFromCart, getTotal, isOpen, closeCart } = useCart()

  const handleCheckout = () => {
    closeCart()
    navigate("/checkout")
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCart}
              className="fixed inset-0 bg-black/80 z-50 backdrop-blur-sm"
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full sm:w-96 bg-card border-l border-border z-50 overflow-y-auto"
            >
              <div className="flex items-center justify-between p-4 border-b border-border bg-primary/5">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-6 h-6 text-primary" />
                  <h2 className="text-xl font-bold">Cart ({cartItems.length})</h2>
                </div>
                <button
                  onClick={closeCart}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                  aria-label="Close cart"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {cartItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[calc(100%-80px)] p-8 text-center">
                  <ShoppingCart className="w-16 h-16 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">Your cart is empty</p>
                  <button
                    onClick={() => {
                      closeCart()
                      navigate("/courses")
                    }}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    Browse Courses
                  </button>
                </div>
              ) : (
                <>
                  <div className="p-4 space-y-4">
                    {cartItems.map((item) => (
                      <div
                        key={item.id}
                        className="bg-muted/50 rounded-lg p-4 flex gap-4"
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold mb-1 truncate">{item.title}</h3>
                          <p className="text-sm text-muted-foreground truncate mb-2">
                            {item.instructorName}
                          </p>
                          <p className="font-bold text-primary">৳{item.price || 0}</p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="p-2 hover:bg-destructive/10 hover:text-destructive rounded-lg transition-colors self-start"
                          aria-label="Remove from cart"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="sticky bottom-0 p-4 border-t border-border bg-card/95 backdrop-blur-sm">
                    <div className="flex justify-between mb-4 text-lg font-bold">
                      <span>Total:</span>
                      <span>৳{getTotal()}</span>
                    </div>
                    <button
                      onClick={handleCheckout}
                      className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      Proceed to Checkout
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
