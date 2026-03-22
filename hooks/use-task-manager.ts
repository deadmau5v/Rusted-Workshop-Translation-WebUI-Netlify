"use client"

import { useState, useEffect, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import { downloadFile, downloadFileFromUrl } from "@/lib/utils/file"
import { POLL_INTERVAL } from "@/constants"
import type { TaskStatus } from "@/types"

export const useTaskManager = () => {
  const [taskKey, setTaskKey] = useState<string>("")
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [fileName, setFileName] = useState<string>("")
  const [, setTargetLanguage] = useState<string>("")
  const { toast } = useToast()

  const buildDownloadFilename = (sourceFilename: string) => {
    const baseName = sourceFilename.replace(/\.rwmod$/i, "")
    return `${baseName}_translated.rwmod`
  }

  const createTask = async (file: File, translateStyle: string, targetLanguage: string = "zh-CN") => {
    setIsUploading(true)
    try {
      const result = await api.createTask(file, translateStyle, targetLanguage)
      console.log("Create task result:", result)
      console.log("Result data type:", typeof result.data)
      console.log("Result data:", result.data)

              if (result.success) {
          // 确保 taskKey 是字符串
          let taskKeyStr: string
          if (typeof result.data === 'string') {
            taskKeyStr = result.data
          } else if (result.data && typeof result.data === 'object' && 'task_key' in result.data) {
            // 如果返回的是对象，尝试提取 task_key
            taskKeyStr = (result.data as any).task_key
            console.log("Extracted task_key from object:", taskKeyStr)
          } else {
            taskKeyStr = String(result.data)
            console.log("Converted to string:", taskKeyStr)
          }
          console.log("Setting taskKey to:", taskKeyStr)
          setTaskKey(taskKeyStr)
        setFileName(file.name)
        setTargetLanguage(targetLanguage)
        toast({
          title: "上传成功",
          description: "模组文件已上传，开始处理中...",
        })
      } else {
        throw new Error(result.message || "上传失败")
      }
    } catch (error) {
      toast({
        title: "上传失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const restoreTask = async (taskId: string) => {
    setIsRestoring(true)
    try {
      const result = await api.getTaskStatus(taskId)

      if (result.success) {
        setTaskKey(taskId)
        setTaskStatus(result.data)
        setFileName(result.data.filename || `task_${taskId}`)
        setTargetLanguage(result.data.target_language || "")
        toast({
          title: "任务恢复成功",
          description: `已恢复任务 ${taskId}`,
        })
      } else {
        throw new Error(result.message || "任务不存在或已过期")
      }
    } catch (error) {
      toast({
        title: "恢复失败",
        description: error instanceof Error ? error.message : "无法找到该任务",
        variant: "destructive",
      })
    } finally {
      setIsRestoring(false)
    }
  }

  const checkTaskStatus = useCallback(async () => {
    if (!taskKey) return

    try {
      const result = await api.getTaskStatus(taskKey)

      if (result.success) {
        setTaskStatus(result.data)
        if (result.data.target_language) {
          setTargetLanguage(result.data.target_language)
        }

        if (result.data.status === "completed") {
          toast({
            title: "汉化完成",
            description: "你的模组已成功汉化，可以下载了！",
          })
        } else if (result.data.status === "failed") {
          toast({
            title: "汉化失败",
            description: result.data.message || "处理过程中出现错误",
            variant: "destructive",
          })
        }
      }
    } catch (error) {
      console.error("Failed to check task status:", error)
    }
  }, [taskKey, toast])

  const downloadResult = async (filename?: string) => {
    if (!taskKey) return

    try {
      const downloadFilename = buildDownloadFilename(filename || fileName)
      const downloadUrl = await api.getDownloadResultUrl(taskKey)

      try {
        downloadFileFromUrl(downloadUrl, downloadFilename)
      } catch (error) {
        console.error("Failed to trigger direct download, falling back to blob download:", error)
        const response = await api.downloadResult(taskKey)

        if (!response.ok) {
          throw new Error("下载失败")
        }

        const blob = await response.blob()
        downloadFile(blob, downloadFilename)
      }

      toast({
        title: "下载成功",
        description: "汉化模组已开始下载",
      })
    } catch (error) {
      toast({
        title: "下载失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const cancelTask = async () => {
    if (!taskKey) return

    try {
      const result = await api.cancelTask(taskKey)

      if (result.success) {
        reset()
        toast({
          title: "任务已取消",
          description: "你可以重新上传文件",
        })
      }
    } catch (error) {
      toast({
        title: "取消失败",
        description: "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const retryTask = async () => {
    if (!taskKey) return

    try {
      const result = await api.retryTask(taskKey)

      if (result.success) {
        toast({
          title: "重试成功",
          description: "任务已重新开始处理",
        })
        checkTaskStatus()
      } else {
        throw new Error(result.message || "重试失败")
      }
    } catch (error) {
      toast({
        title: "重试失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const reset = () => {
    setTaskKey("")
    setTaskStatus(null)
    setFileName("")
    setTargetLanguage("")
  }

  // 轮询任务状态
  useEffect(() => {
    if (taskKey && taskStatus?.status !== "completed" && taskStatus?.status !== "failed") {
      const interval = setInterval(checkTaskStatus, POLL_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [taskKey, taskStatus?.status, checkTaskStatus])

  return {
    taskKey,
    taskStatus,
    fileName,
    isUploading,
    isRestoring,
    createTask,
    restoreTask,
    downloadResult,
    cancelTask,
    retryTask,
    reset,
  }
}
