# CMake generated Testfile for 
# Source directory: /mnt/sdd/Quark/quarkRSP
# Build directory: /mnt/sdd/Quark/runtime/build-linux/quarkRSP
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
add_test(quarkRSP_tests "/mnt/sdd/Quark/runtime/build-linux/quarkRSP/quarkRSP_tests")
set_tests_properties(quarkRSP_tests PROPERTIES  _BACKTRACE_TRIPLES "/mnt/sdd/Quark/quarkRSP/CMakeLists.txt;110;add_test;/mnt/sdd/Quark/quarkRSP/CMakeLists.txt;0;")
add_test(quarkRSP_gui_tests "/mnt/sdd/Quark/runtime/build-linux/quarkRSP/quarkRSP_gui_tests")
set_tests_properties(quarkRSP_gui_tests PROPERTIES  ENVIRONMENT "QT_QPA_PLATFORM=offscreen" _BACKTRACE_TRIPLES "/mnt/sdd/Quark/quarkRSP/CMakeLists.txt;291;add_test;/mnt/sdd/Quark/quarkRSP/CMakeLists.txt;0;")
