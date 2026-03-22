import { FILE_SIZE_LIMIT } from "@/constants"

export const validateFile = (file: File) => {
  if (!file.name.endsWith(".rwmod")) {
    return { valid: false, error: "请选择 .rwmod 格式的模组文件" }
  }

  if (file.size > FILE_SIZE_LIMIT) {
    return { valid: false, error: "文件大小不能超过 100MB" }
  }

  return { valid: true }
}

export const formatFileSize = (bytes: number): string => {
  return (bytes / 1024 / 1024).toFixed(2) + " MB"
}

export const downloadFile = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob)
  downloadFileFromUrl(url, filename)

  // Revoke after the browser has consumed the object URL.
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url)
  }, 1000)
}

export const downloadFileFromUrl = (url: string, filename?: string) => {
  const a = document.createElement("a")
  a.href = url
  if (filename) {
    a.download = filename
  }
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
