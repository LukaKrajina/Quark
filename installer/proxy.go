<<<<<<< HEAD
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func main() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		os.Exit(1)
	}
	quarkDir := filepath.Join(homeDir, ".quark")
	activeVersionPath := filepath.Join(quarkDir, "active_version.txt")
	versionBytes, err := os.ReadFile(activeVersionPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Quark is installed, but no toolchain is active.")
		fmt.Fprintln(os.Stderr, "Run 'quarkup default stable' to configure your environment.")
		os.Exit(1)
	}

	rawString := string(versionBytes)
	cleanString := strings.TrimPrefix(rawString, "\xff\xfe")
	cleanString = strings.TrimPrefix(cleanString, "\xfe\xff")
	cleanString = strings.TrimPrefix(cleanString, "\xef\xbb\xbf")
	cleanString = strings.ReplaceAll(cleanString, "\x00", "")
	activeVersion := strings.TrimSpace(cleanString)
	binDir := filepath.Join(quarkDir, "toolchains", activeVersion, "bin")
	realCompiler := filepath.Join(binDir, "runtime.exe")

	if _, err := os.Stat(realCompiler); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Quark Error: Active toolchain '%s' is missing or corrupted.\n", activeVersion)
		fmt.Fprintln(os.Stderr, "Run 'quarkup update' to restore it.")
		os.Exit(1)
	}

	cmd := exec.Command(realCompiler, os.Args[1:]...)

	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err = cmd.Run()
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			os.Exit(exitError.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "Quark Execution Error: %v\n", err)
		os.Exit(1)
	}
}
=======
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// cleanVersion 去除 active_version.txt 中可能存在的 BOM 与 NUL 字节。
func cleanVersion(raw string) string {
	s := strings.TrimPrefix(raw, "\xff\xfe")
	s = strings.TrimPrefix(s, "\xfe\xff")
	s = strings.TrimPrefix(s, "\xef\xbb\xbf")
	s = strings.ReplaceAll(s, "\x00", "")
	return strings.TrimSpace(s)
}

func main() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Quark Error: cannot determine home directory:", err)
		os.Exit(1)
	}
	quarkDir := filepath.Join(homeDir, ".quark")
	activeVersionPath := filepath.Join(quarkDir, "active_version.txt")

	// install 子命令:把当前激活工具链的 bin 目录加入 PATH
	if len(os.Args) >= 2 && os.Args[1] == "install" {
		versionBytes, err := os.ReadFile(activeVersionPath)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Quark is installed, but no toolchain is active.")
			fmt.Fprintln(os.Stderr, "Run 'quarkup default stable' to configure your environment.")
			os.Exit(1)
		}
		activeVersion := cleanVersion(string(versionBytes))
		binDir := filepath.Join(quarkDir, "toolchains", activeVersion, "bin")
		if err := installToPath(binDir); err != nil {
			fmt.Fprintf(os.Stderr, "Quark Error: failed to add toolchain to PATH: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("Quark toolchain '%s' added to PATH (%s).\n", activeVersion, binDir)
		os.Exit(0)
	}

	versionBytes, err := os.ReadFile(activeVersionPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Quark is installed, but no toolchain is active.")
		fmt.Fprintln(os.Stderr, "Run 'quarkup default stable' to configure your environment.")
		os.Exit(1)
	}

	activeVersion := cleanVersion(string(versionBytes))
	binDir := filepath.Join(quarkDir, "toolchains", activeVersion, "bin")
	realCompiler := filepath.Join(binDir, "runtime.exe")

	if _, err := os.Stat(realCompiler); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Quark Error: Active toolchain '%s' is missing or corrupted.\n", activeVersion)
		fmt.Fprintln(os.Stderr, "Run 'quarkup update' to restore it.")
		os.Exit(1)
	}

	cmd := exec.Command(realCompiler, os.Args[1:]...)

	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err = cmd.Run()
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			os.Exit(exitError.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "Quark Execution Error: %v\n", err)
		os.Exit(1)
	}
}
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
