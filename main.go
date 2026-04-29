// Package main is the entry point for whatomate - a WhatsApp automation tool.
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var (
	// Version is set during build via ldflags
	Version = "dev"
	// Commit is the git commit hash set during build
	Commit = "none"
	// Date is the build date set during build
	Date = "unknown"
)

// rootCmd is the base command for the whatomate CLI
var rootCmd = &cobra.Command{
	Use:   "whatomate",
	Short: "WhatsApp automation tool",
	Long: `whatomate is a CLI tool for automating WhatsApp messages and workflows.
It allows you to send messages, manage contacts, and automate
repetitive WhatsApp tasks from the command line.`,
	SilenceUsage:  true,
	SilenceErrors: true, // handle errors ourselves for cleaner output
}

// versionCmd prints the current version information
var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("whatomate version %s\n", Version)
		fmt.Printf("  commit: %s\n", Commit)
		fmt.Printf("  built:  %s\n", Date)
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
