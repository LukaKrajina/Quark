#pragma once
// ============================================================================
//  GPU 后端与 CPU 向量扩展的检测与抽象
//
//  国产化加速适配：
//    - NVIDIA CUDA   nvcc：__CUDACC__ / __CUDA_ARCH__ / __NVCC__
//    - 摩尔线程 MUSA mcc：__MUSA__ / __MUSA_ARCH__（源码级兼容 CUDA）
//    - AMD HIP        hipcc：__HIPCC__ / __HIP_DEVICE_COMPILE__
//
//    - 龙芯 LoongArch LSX（128 位）/ LASX（256 位）向量扩展：
//        __loongarch_sx / __loongarch_asx（类比 SSE / AVX2）
//
//  摩尔线程 MUSA 与 CUDA 源码级兼容（可用musify 工具迁移）
// 因此二者统一为「类 CUDA」编程模型（QUARK_GPU_NVIDIA_LIKE），上层代码无需区分。
// ============================================================================

// ---------------------------------------------------------------------------
// GPU 后端检测
// ---------------------------------------------------------------------------
#if defined(__CUDACC__) || defined(__CUDA_ARCH__) || defined(__NVCC__)
  #define QUARK_GPU_CUDA 1
#endif

#if defined(__MUSA__) || defined(__MUSA_ARCH__) || defined(MUSA) || defined(__MCC__)
  #define QUARK_GPU_MUSA 1
#endif

#if defined(__HIPCC__) || defined(__HIP_DEVICE_COMPILE__) || defined(__HIP_PLATFORM_AMD__)
  #define QUARK_GPU_HIP 1
#endif

// CUDA 与 MUSA 源码级兼容，统一为「类 CUDA」编程模型
#if defined(QUARK_GPU_CUDA) || defined(QUARK_GPU_MUSA)
  #define QUARK_GPU_NVIDIA_LIKE 1
#endif

// ---------------------------------------------------------------------------
// CPU 向量扩展检测（x86 AVX 优先，龙芯 LSX/LASX 次之）
// ---------------------------------------------------------------------------
#if defined(__AVX512F__)
  #define QUARK_SIMD_AVX512 1
#elif defined(__AVX2__)
  #define QUARK_SIMD_AVX2 1
#elif defined(__loongarch_asx)
  #define QUARK_SIMD_LASX 1       // 龙芯 256 位向量（类比 AVX2）
#elif defined(__loongarch_sx)
  #define QUARK_SIMD_LSX 1        // 龙芯 128 位向量（类比 SSE）
#endif

// ---------------------------------------------------------------------------
// 设备函数属性（CUDA / MUSA / HIP 用 __device__/__global__；CPU 编译展开为空）
// ---------------------------------------------------------------------------
#if defined(QUARK_GPU_CUDA) || defined(QUARK_GPU_MUSA) || defined(QUARK_GPU_HIP)
  #define QUARK_GPU_DEVICE      __device__
  #define QUARK_GPU_GLOBAL      __global__
  #define QUARK_GPU_HOST_DEVICE __host__ __device__
#else
  #define QUARK_GPU_DEVICE
  #define QUARK_GPU_GLOBAL
  #define QUARK_GPU_HOST_DEVICE
#endif