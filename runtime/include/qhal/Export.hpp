<<<<<<< HEAD
#pragma once

#if defined(_WIN32)
  #if defined(QUARK_RT_BUILD)
    #define QUARK_RT_API __declspec(dllexport)
  #else
    #define QUARK_RT_API __declspec(dllimport)
  #endif
#else
  #define QUARK_RT_API __attribute__((visibility("default")))
#endif
=======
#pragma once

#if defined(_WIN32)
  #if defined(QUARK_RT_BUILD)
    #define QUARK_RT_API __declspec(dllexport)
  #else
    #define QUARK_RT_API __declspec(dllimport)
  #endif
#else
  #define QUARK_RT_API __attribute__((visibility("default")))
#endif
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
