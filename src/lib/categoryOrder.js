const getTimestampMillis = (value) => {
  if (value?.toMillis) return value.toMillis()
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000
  return 0
}

export const sortCategoriesByDisplayOrder = (categories) =>
  [...categories].sort((first, second) => {
    const firstOrder = Number(first.displayOrder)
    const secondOrder = Number(second.displayOrder)
    const firstHasOrder = Number.isFinite(firstOrder)
    const secondHasOrder = Number.isFinite(secondOrder)

    if (firstHasOrder && secondHasOrder && firstOrder !== secondOrder) {
      return firstOrder - secondOrder
    }
    if (firstHasOrder !== secondHasOrder) {
      return firstHasOrder ? -1 : 1
    }

    const createdDifference =
      getTimestampMillis(first.createdAt) - getTimestampMillis(second.createdAt)
    if (createdDifference !== 0) return createdDifference

    return String(first.title || "").localeCompare(String(second.title || ""))
  })

export const normalizeCategoryOrder = (categories) =>
  sortCategoriesByDisplayOrder(categories).map((category, index) => ({
    ...category,
    displayOrder: index,
  }))
