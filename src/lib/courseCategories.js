export const getCourseCategories = (course) => {
  const values = Array.isArray(course?.categories)
    ? course.categories
    : [course?.category]

  return [
    ...new Set(
      values
        .filter((category) => typeof category === "string" && category.trim())
        .map((category) => category.trim()),
    ),
  ]
}
