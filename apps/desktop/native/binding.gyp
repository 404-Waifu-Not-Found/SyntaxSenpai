{
  "targets": [
    {
      "target_name": "cubism_native",
      "sources": [
        "src/addon.cc",
        "../../CubismSdkForNative-5-r.5/Framework/src/CubismCdiJson.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/CubismDefaultParameterId.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/CubismFramework.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/CubismModelSettingJson.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Effect/CubismBreath.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Effect/CubismEyeBlink.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Effect/CubismLook.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Effect/CubismPose.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Id/CubismId.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Id/CubismIdManager.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Math/CubismMath.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Math/CubismMatrix44.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Math/CubismModelMatrix.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Math/CubismTargetPoint.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Math/CubismVector2.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Math/CubismViewMatrix.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Model/CubismMoc.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Model/CubismModel.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Model/CubismModelMultiplyAndScreenColor.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Model/CubismModelUserData.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Model/CubismModelUserDataJson.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Model/CubismUserModel.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/ACubismMotion.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismBreathUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismExpressionMotion.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismExpressionMotionManager.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismExpressionUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismEyeBlinkUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismLipSyncUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismLookUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismMotion.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismMotionJson.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismMotionManager.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismMotionQueueEntry.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismMotionQueueManager.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismPhysicsUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismPoseUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/CubismUpdateScheduler.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/ICubismUpdater.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Motion/IParameterProvider.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Physics/CubismPhysics.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Physics/CubismPhysicsJson.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Rendering/csmBlendMode.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Rendering/CubismRenderer.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Type/csmRectF.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Type/csmString.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Utils/CubismDebug.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Utils/CubismJson.cpp",
        "../../CubismSdkForNative-5-r.5/Framework/src/Utils/CubismString.cpp"
      ],
      "include_dirs": [
        "../../CubismSdkForNative-5-r.5/Framework/src"
      ],
      "cflags_cc": [
        "-std=c++17"
      ],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "LanguageStandard": "stdcpp17"
            }
          }
        }]
      ]
    }
  ]
}
