# Additional clean files
cmake_minimum_required(VERSION 3.16)

if("${CONFIG}" STREQUAL "" OR "${CONFIG}" STREQUAL "Release")
  file(REMOVE_RECURSE
  "quarkRSP/CMakeFiles/quarkRSP_gui_autogen.dir/AutogenUsed.txt"
  "quarkRSP/CMakeFiles/quarkRSP_gui_autogen.dir/ParseCache.txt"
  "quarkRSP/CMakeFiles/quarkRSP_sim_autogen.dir/AutogenUsed.txt"
  "quarkRSP/CMakeFiles/quarkRSP_sim_autogen.dir/ParseCache.txt"
  "quarkRSP/quarkRSP_gui_autogen"
  "quarkRSP/quarkRSP_sim_autogen"
  )
endif()
