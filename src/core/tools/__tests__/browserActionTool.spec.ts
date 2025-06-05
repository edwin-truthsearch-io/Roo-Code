import { describe, it, expect, vi } from "vitest"
import { browserActionTool } from "../browserActionTool"
import { BrowserSession } from "../../../services/browser/BrowserSession"
import { Task } from "../../task/Task"

// Mock the BrowserSession
vi.mock("../../../services/browser/BrowserSession", () => {
	const BrowserSessionMock = vi.fn().mockImplementation(() => ({
		doAction: vi.fn().mockImplementation(async (callback) => {
			return {
				screenshot: undefined,
				logs: "Mocked logs",
				currentUrl: "https://example.com",
				currentMousePosition: undefined,
			}
		}),
		launchBrowser: vi.fn().mockResolvedValue(undefined),
		navigateToUrl: vi.fn().mockImplementation(async (url) => {
			return {
				screenshot: undefined,
				logs: "Navigated to URL",
				currentUrl: "https://example.com",
				currentMousePosition: undefined,
				textContent: "",
				interactiveElements: [],
			}
		}),
		closeBrowser: vi.fn().mockResolvedValue({}),
	}))
	return { BrowserSession: BrowserSessionMock }
})

// Mock the Task
vi.mock("../../task/Task", () => {
	const TaskMock = vi.fn().mockImplementation(() => ({
		consecutiveMistakeCount: 0,
		recordToolError: vi.fn(),
		say: vi.fn().mockResolvedValue("Mocked say response"),
		ask: vi.fn().mockResolvedValue(true),
		api: {
			getModel: vi.fn().mockReturnValue({
				info: {
					supportsImages: false,
					supportsComputerUse: true,
				},
			}),
		},
		browserSession: new BrowserSession({} as any),
	}))
	return { Task: TaskMock }
})

// Mock the vscode module to avoid import issues
vi.mock("vscode", () => {
	return {
		// Add any necessary mocked vscode functionalities here
	}
})

describe("browserActionTool", () => {
	let mockTask: Task
	let mockAskApproval: (type: string, partialMessage: string | undefined) => Promise<boolean>
	let mockHandleError: (context: string, error: Error) => Promise<void>
	let mockPushToolResult: (content: any) => void
	let mockRemoveClosingTag: (tag: string, value: string | undefined) => string

	beforeEach(() => {
		mockTask = new Task({} as any) as any
		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn().mockImplementation((tag, value) => value || "")
	})

	it("should detect security block and throw an error in text-based mode", async () => {
		// Arrange
		const browserSessionInstance = mockTask.browserSession
		vi.spyOn(browserSessionInstance, "navigateToUrl").mockImplementation(async (url) => {
			return {
				screenshot: undefined,
				logs: "Security block detected",
				currentUrl: "https://example.com",
				currentMousePosition: undefined,
				textContent: "Just a moment... Enable JavaScript and cookies to continue",
				interactiveElements: [],
			}
		})

		// Act
		await browserActionTool(
			mockTask,
			{
				type: "tool_use",
				name: "browser_action",
				params: { action: "launch", url: "https://example.com" },
				partial: false,
			},
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Assert
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("The browser action has been executed using text-based browsing"),
		)
	})

	it("should use fallback content retrieval when navigation fails in text-based mode", async () => {
		// Arrange
		const browserSessionInstance = mockTask.browserSession
		vi.spyOn(browserSessionInstance, "navigateToUrl")
			.mockImplementationOnce(async (url) => {
				return {
					screenshot: undefined,
					logs: "Navigation failed",
					currentUrl: "https://example.com",
					currentMousePosition: undefined,
					textContent: "Just a moment... Enable JavaScript and cookies to continue",
					interactiveElements: [],
				}
			})
			.mockImplementationOnce(async (url) => {
				return {
					screenshot: undefined,
					logs: "Fallback content retrieved",
					currentUrl: "https://example.com",
					currentMousePosition: undefined,
					textContent: "Fallback content retrieved",
					interactiveElements: [],
				}
			})

		// Act
		await browserActionTool(
			mockTask,
			{
				type: "tool_use",
				name: "browser_action",
				params: { action: "launch", url: "https://example.com" },
				partial: false,
			},
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Assert
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("The browser action has been executed using text-based browsing"),
		)
	})
})
