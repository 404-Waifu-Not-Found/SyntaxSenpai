#include <napi.h>
#include <cstdio>
#include <cstdlib>
#if defined(_MSC_VER)
#include <malloc.h>
#endif
#include <fstream>
#include <filesystem>
#include <memory>
#include <map>
#include <vector>
#include <string>

#include "CubismFramework.hpp"
#include "CubismModelSettingJson.hpp"

namespace fs = std::filesystem;
using namespace Live2D::Cubism::Framework;
using namespace Live2D::Cubism::Framework::Utils;

static std::string g_activeModelDirectory;

struct ModelRecord {
  std::unique_ptr<CubismModelSettingJson> setting;
  std::unique_ptr<csmByte[]> buffer;
};

static std::map<uint32_t, ModelRecord> g_models;
static uint32_t g_nextModelId = 1;
static bool g_frameworkStarted = false;
static bool g_frameworkInitialized = false;

class NativeAllocator : public ICubismAllocator {
public:
  void* Allocate(const csmSizeType size) override {
    return std::malloc(static_cast<size_t>(size));
  }

  void Deallocate(void* memory) override {
    std::free(memory);
  }

  void* AllocateAligned(const csmSizeType size, const csmUint32 alignment) override {
    void* result = nullptr;
#if defined(_MSC_VER)
    result = _aligned_malloc(static_cast<size_t>(size), static_cast<size_t>(alignment));
#else
    if (posix_memalign(&result, static_cast<size_t>(alignment), static_cast<size_t>(size)) != 0) {
      result = nullptr;
    }
#endif
    return result;
  }

  void DeallocateAligned(void* alignedMemory) override {
#if defined(_MSC_VER)
    _aligned_free(alignedMemory);
#else
    std::free(alignedMemory);
#endif
  }
};

static NativeAllocator g_allocator;

static void NativeLogFunction(const csmChar* message) {
  if (message) {
    std::fprintf(stderr, "[cubism-native] %s\n", message);
  }
}

static csmByte* NativeLoadFile(const std::string filePath, csmSizeInt* outSize) {
  fs::path resolvedPath(filePath);
  if (!resolvedPath.is_absolute() && !g_activeModelDirectory.empty()) {
    resolvedPath = fs::path(g_activeModelDirectory) / resolvedPath;
  }
  resolvedPath = resolvedPath.lexically_normal();

  std::ifstream input(resolvedPath.string(), std::ios::binary | std::ios::ate);
  if (!input) {
    return nullptr;
  }
  std::streamsize size = input.tellg();
  if (size <= 0) {
    return nullptr;
  }
  input.seekg(0, std::ios::beg);
  std::unique_ptr<csmByte[]> buffer(new csmByte[static_cast<size_t>(size)]);
  if (!input.read(reinterpret_cast<char*>(buffer.get()), size)) {
    return nullptr;
  }
  *outSize = static_cast<csmSizeInt>(size);
  return buffer.release();
}

static void NativeReleaseBytes(csmByte* byteData) {
  delete[] byteData;
}

static bool EnsureFrameworkInitialized() {
  if (g_frameworkStarted) {
    return true;
  }

  CubismFramework::Option option;
  option.LogFunction = NativeLogFunction;
  option.LoggingLevel = CubismFramework::Option::LogLevel_Info;
  option.LoadFileFunction = NativeLoadFile;
  option.ReleaseBytesFunction = NativeReleaseBytes;

  if (!CubismFramework::StartUp(&g_allocator, &option)) {
    return false;
  }

  CubismFramework::Initialize();
  g_frameworkStarted = true;
  g_frameworkInitialized = true;
  return true;
}

static Napi::Value InitCubism(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool ok = EnsureFrameworkInitialized();
  return Napi::Boolean::New(env, ok);
}

static Napi::Value IsCubismAvailable(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, g_frameworkStarted);
}

static Napi::Value GetCubismVersion(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const auto version = Live2D::Cubism::Core::csmGetVersion();
  const uint32_t major = static_cast<uint32_t>((version & 0xFF000000) >> 24);
  const uint32_t minor = static_cast<uint32_t>((version & 0x00FF0000) >> 16);
  const uint32_t patch = static_cast<uint32_t>((version & 0x0000FFFF));
  std::string versionString = std::to_string(major) + "." + std::to_string(minor) + "." + std::to_string(patch);
  return Napi::String::New(env, versionString);
}

static Napi::Value LoadModelInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected model JSON path").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string modelJsonPath = info[0].As<Napi::String>().Utf8Value();
  g_activeModelDirectory = fs::path(modelJsonPath).parent_path().string();
  if (!EnsureFrameworkInitialized()) {
    Napi::Error::New(env, "Cubism framework failed to initialize").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::ifstream input(modelJsonPath, std::ios::binary | std::ios::ate);
  if (!input) {
    Napi::Error::New(env, "Unable to read model JSON file").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::streamsize size = input.tellg();
  if (size <= 0) {
    Napi::Error::New(env, "Model JSON file is empty").ThrowAsJavaScriptException();
    return env.Null();
  }
  input.seekg(0, std::ios::beg);

  std::unique_ptr<csmByte[]> buffer(new csmByte[static_cast<size_t>(size)]);
  if (!input.read(reinterpret_cast<char*>(buffer.get()), size)) {
    Napi::Error::New(env, "Failed to read model JSON file").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::unique_ptr<CubismModelSettingJson> setting(new CubismModelSettingJson(buffer.get(), static_cast<csmSizeInt>(size)));
  if (!setting) {
    Napi::Error::New(env, "Unable to create Cubism model settings").ThrowAsJavaScriptException();
    return env.Null();
  }

  uint32_t modelId = g_nextModelId++;
  g_models[modelId] = ModelRecord{std::move(setting), std::move(buffer)};
  CubismModelSettingJson* modelSetting = g_models[modelId].setting.get();

  Napi::Object result = Napi::Object::New(env);
  result.Set("modelId", Napi::Number::New(env, modelId));
  result.Set("modelFile", Napi::String::New(env, modelSetting->GetModelFileName() ? modelSetting->GetModelFileName() : ""));

  Napi::Array textures = Napi::Array::New(env, modelSetting->GetTextureCount());
  for (csmInt32 i = 0; i < modelSetting->GetTextureCount(); ++i) {
    const csmChar* textureFile = modelSetting->GetTextureFileName(i);
    textures.Set(i, Napi::String::New(env, textureFile ? textureFile : ""));
  }
  result.Set("textures", textures);

  Napi::Array motions = Napi::Array::New(env, modelSetting->GetMotionGroupCount());
  for (csmInt32 g = 0; g < modelSetting->GetMotionGroupCount(); ++g) {
    Napi::Object motionGroup = Napi::Object::New(env);
    const csmChar* groupName = modelSetting->GetMotionGroupName(g);
    motionGroup.Set("groupName", Napi::String::New(env, groupName ? groupName : ""));

    csmInt32 motionCount = modelSetting->GetMotionCount(groupName);
    Napi::Array motionFiles = Napi::Array::New(env, motionCount);
    for (csmInt32 m = 0; m < motionCount; ++m) {
      const csmChar* motionFile = modelSetting->GetMotionFileName(groupName, m);
      motionFiles.Set(m, Napi::String::New(env, motionFile ? motionFile : ""));
    }
    motionGroup.Set("files", motionFiles);
    motions.Set(g, motionGroup);
  }
  result.Set("motions", motions);

  Napi::Array expressions = Napi::Array::New(env, modelSetting->GetExpressionCount());
  for (csmInt32 e = 0; e < modelSetting->GetExpressionCount(); ++e) {
    const csmChar* expressionName = modelSetting->GetExpressionName(e);
    expressions.Set(e, Napi::String::New(env, expressionName ? expressionName : ""));
  }
  result.Set("expressions", expressions);

  result.Set("physicsFile", Napi::String::New(env, modelSetting->GetPhysicsFileName() ? modelSetting->GetPhysicsFileName() : ""));
  result.Set("poseFile", Napi::String::New(env, modelSetting->GetPoseFileName() ? modelSetting->GetPoseFileName() : ""));

  return result;
}

static Napi::Value ReleaseModel(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected model ID").ThrowAsJavaScriptException();
    return env.Null();
  }
  uint32_t modelId = info[0].As<Napi::Number>().Uint32Value();
  auto it = g_models.find(modelId);
  if (it != g_models.end()) {
    g_models.erase(it);
  }
  return env.Null();
}

static Napi::Value DisposeCubism(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  g_models.clear();
  if (g_frameworkInitialized) {
    CubismFramework::Dispose();
    CubismFramework::CleanUp();
    g_frameworkInitialized = false;
    g_frameworkStarted = false;
  }
  return Napi::Boolean::New(env, true);
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("initCubism", Napi::Function::New(env, InitCubism));
  exports.Set("isAvailable", Napi::Function::New(env, IsCubismAvailable));
  exports.Set("getVersion", Napi::Function::New(env, GetCubismVersion));
  exports.Set("loadModelInfo", Napi::Function::New(env, LoadModelInfo));
  exports.Set("releaseModel", Napi::Function::New(env, ReleaseModel));
  exports.Set("dispose", Napi::Function::New(env, DisposeCubism));
  return exports;
}

NODE_API_MODULE(cubism_native, Init)
