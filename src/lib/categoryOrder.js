const getTimestampMillis = (value) => {
  if (value?.toMillis) return value.toMillis()
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000
  return 0
}

const getCategoryOrder = (category) => {
  const order = Number(category.order)
  if (Number.isFinite(order)) return order

  const legacyOrder = Number(category.displayOrder)
  return Number.isFinite(legacyOrder) ? legacyOrder : null
}

export const sortCategoriesByOrder = (categories) =>
  [...categories].sort((first, second) => {
    const firstOrder = getCategoryOrder(first)
    const secondOrder = getCategoryOrder(second)
    const firstHasOrder = firstOrder !== null
    const secondHasOrder = secondOrder !== null

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
  sortCategoriesByOrder(categories).map((category, index) => ({
    ...category,
    order: index,
  }))
