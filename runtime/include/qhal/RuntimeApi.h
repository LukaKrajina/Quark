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

#ifdef __cplusplus
extern "C"
{
#endif

  typedef struct quark_runtime quark_runtime;

  QUARK_RT_API quark_runtime *quark_runtime_create(void);
  QUARK_RT_API void quark_runtime_destroy(quark_runtime *rt);
  QUARK_RT_API void quark_runtime_viz_start(quark_runtime *rt);
  QUARK_RT_API void quark_runtime_viz_stop(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_compile(quark_runtime *rt, const char *ir);
  QUARK_RT_API const char *quark_runtime_execute_int(quark_runtime *rt, const char *func_name);
  QUARK_RT_API const char *quark_runtime_execute_float(quark_runtime *rt, const char *func_name);
  QUARK_RT_API const char *quark_runtime_execute_void(quark_runtime *rt, const char *func_name);
  QUARK_RT_API const char *quark_runtime_aot_compile(quark_runtime *rt,
                                                     const char *arch,
                                                     const char *mode,
                                                     const char *output_name,
                                                     const char *ir);
  QUARK_RT_API const char *quark_runtime_snapshot(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_verify(quark_runtime *rt, const char *vc_protocol);

  typedef struct quark_mmi quark_mmi;

  QUARK_RT_API const char *quark_runtime_export_mmi(quark_runtime *rt,
                                                    const char *header_json,
                                                    const char *ir,
                                                    const char *output_path);
  QUARK_RT_API quark_mmi *quark_runtime_load_mmi(quark_runtime *rt, const char *path);
  QUARK_RT_API const char *quark_runtime_mmi_invoke(quark_mmi *m,
                                                    const char *func_name,
                                                    const char *args_json);
  QUARK_RT_API void quark_runtime_mmi_unload(quark_mmi *m);

#ifdef __cplusplus
}
#endif