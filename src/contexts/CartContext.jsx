import { createContext, useContext, useState, useEffect } from "react"

const CartContext = createContext({})

export const useCart = () => {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error("useCart must be used within CartProvider")
  }
  return context
}

export function CartProvider({ children }) {
  const [cartItems, setCartItems] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("cart")
    if (stored) {
      try {
        setCartItems(JSON.parse(stored))
      } catch (error) {
        console.error("Error loading cart:", error)
      }
    }
    setIsLoaded(true)
  }, [])

  useEffect(() => {
    localStorage.setItem("cart", JSON.stringify(cartItems))
  }, [cartItems])

  const addToCart = (course) => {
    const exists = cartItems.find((item) => item.id === course.id)
    if (exists) {
      return false
    }
    setCartItems([...cartItems, course])
    return true
  }

  const removeFromCart = (courseId) => {
    setCartItems(cartItems.filter((item) => item.id !== courseId))
  }

  const clearCart = () => {
    setCartItems([])
  }

  const getTotal = () => {
    return cartItems.reduce((total, item) => total + (item.price || 0), 0)
  }

  const openCart = () => setIsOpen(true)
  const closeCart = () => setIsOpen(false)

  const value = {
    cartItems,
    addToCart,
    removeFromCart,
    clearCart,
    getTotal,
    isOpen,
    openCart,
    closeCart,
    isLoaded,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
