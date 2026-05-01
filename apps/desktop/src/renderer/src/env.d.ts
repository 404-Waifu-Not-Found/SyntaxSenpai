/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, any>
  export default component
}

declare global {
  interface CubismMotionGroup {
    groupName: string
    files: string[]
  }

  interface CubismModelInfo {
    modelId: number
    modelFile: string
    textures: string[]
    motions: CubismMotionGroup[]
    expressions: string[]
    physicsFile: string
    poseFile: string
  }

  interface CubismAPI {
    isAvailable(): boolean
    init(): boolean
    getVersion(): string | null
    loadModelInfo(modelJsonPath: string): CubismModelInfo | null
    releaseModel(modelId: number): void
    dispose(): boolean
  }

  interface L2DModel {
    id: string
    name: string
    path: string
    modelJsonPath: string
    metadata?: Record<string, any>
    importedAt?: string
  }

  interface L2DAPI {
    importModel(): Promise<{ success: boolean; model?: L2DModel; error?: string; canceled?: boolean }>
    listModels(): Promise<{ success: boolean; models?: L2DModel[]; error?: string }>
    deleteModel(modelId: string): Promise<{ success: boolean; error?: string }>
    getModel(modelId: string): Promise<{ success: boolean; model?: L2DModel; error?: string }>
  }

  interface Window {
    cubism: CubismAPI
    l2d: L2DAPI
  }
}
