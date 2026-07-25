# CHANGELOG

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning.

---

## [Unreleased]

### Added
- Standardized AI Operating System folder `.ai/` and directives.
- AI Memory system (`CURRENT_STATUS.md`, `DECISIONS.md`, `KNOWN_BUGS.md`).
- Master entry point `AGENTS.md` and `00_READ_FIRST.md`.
- AI Service Foundation in `src/ai/` (`AIManager`, `VisionProvider`, `OCRProvider`, `LLMProvider`, `LocalVisionProvider`).
- Multi-Deployment Vision Provider Foundation in `src/ai/` (`AIExecutionMode`, `NormalizedPoint`, `NormalizedQuad`, `ImageInputSource`, `LocalServiceVisionProvider`, `RemoteAPIVisionProvider`).
- Free Browser Document Corner Detection Provider in `src/ai/browser/` (`browser-image-loader`, `grayscale`, `edge-detector`, `geometry`, `document-corner-detector`, `test-harness`).




---

## [1.0.0] - Initial Production Release

### Added
- Core PrintDesk / Ishita Print Master application codebase.
- Electron desktop wrapper with silent print execution.
- React frontend interface with billing and queue management.
- Backend API services for store management and license verification.
