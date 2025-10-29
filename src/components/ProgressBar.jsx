"use client"

import { motion } from "framer-motion"

export default function ProgressBar({ progress, showLabel = true, showPercentage = true, animated = true }) {
  const ProgressBarContent = (
    <>
      {showLabel && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-medium text-muted-foreground">Progress</span>
          {showPercentage && <span className="text-xs font-semibold text-primary">{progress}%</span>}
        </div>
      )}
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        {animated ? (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="h-full bg-gradient-to-r from-primary to-accent"
          />
        ) : (
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        )}
      </div>
    </>
  )

  return <div className="space-y-1">{ProgressBarContent}</div>
}
