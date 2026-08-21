"use client"

import ManageUsersCore from "./ManageUsersCore"
import UserCourseAccessBridge from "./UserCourseAccessBridge"

export default function ManageUsers() {
  return (
    <UserCourseAccessBridge>
      <ManageUsersCore />
    </UserCourseAccessBridge>
  )
}
