import { browserActionTool } from "../browserActionTool"
import { Task } from "../../task/Task"
import { ToolUse } from "../../../shared/tools"

// Mock the Task class and its dependencies
const mockTask = {
	api: {
		getModel: jest.fn(),
	},
	browserSession: {
		launchBrowser: jest.fn(),
		navigateToUrl: jest.fn(),
		closeBrowser: jest.fn(),
		click: jest.fn(),
		doAction: jest.fn(),
	},
	urlContentFetcher: {
		launchBrowser: jest.fn(),
		urlToMarkdown: jest.fn(),
		closeBrowser: jest.fn(),
	},
	consecutiveMistakeCount: 0,
	recordToolError: jest.fn(),
	sayAndCreateMissingParamError: jest.fn(),
	ask: jest.fn(),
	say: jest.fn(),
} as unknown as Task

const mockAskApproval = jest.fn()
const mockHandleError = jest.fn()
const mockPushToolResult = jest.fn()
const mockRemoveClosingTag = jest.fn((tag: string, content?: string) => content || "")

// Mock the vscode module to avoid import issues in test environment
jest.mock("vscode", () => ({
	// Mock necessary vscode functionalities if needed
	workspace: {
		getConfiguration: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue(undefined),
		}),
	},
	window: {
		showErrorMessage: jest.fn(),
	},
}))

describe("browserActionTool - Enhanced Features", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should handle browser initialization with enhanced logging and validation", async () => {
		// Mock model that does not support images for text-based browsing
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.launchBrowser = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.doAction = jest.fn().mockImplementation(async (callback) => {
			const mockPage = {
				goto: jest.fn().mockResolvedValue(undefined),
				evaluate: jest.fn().mockResolvedValue({
					content: "<html><body><h1>Example Page</h1></body></html>",
					elements: [],
				}),
			}
			await callback(mockPage)
			return {
				logs: "Navigated to https://example.com using text-based browsing",
				textContent: "Example Page",
				currentUrl: "https://example.com",
				interactiveElements: [],
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "launch", url: "https://example.com" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify browser initialization with enhanced logging
		expect(mockTask.browserSession.launchBrowser).toHaveBeenCalled()
		expect(mockTask.browserSession.doAction).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("The browser action has been executed using text-based browsing"),
		)
	})

	it("should handle navigation retries and timeouts in text-based mode", async () => {
		// Mock model that doesn't support images
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)

		// Mock doAction to simulate navigation with retry logic
		mockTask.browserSession.doAction = jest.fn().mockImplementation(async (callback) => {
			const mockPage = {
				goto: jest.fn().mockImplementation(async (url, options) => {
					if (options.timeout > 7000) {
						return Promise.resolve()
					}
					throw new Error("Navigation timeout")
				}),
				evaluate: jest.fn().mockResolvedValue({
					content: "<html><body><h1>Example Page</h1><p>Retry successful.</p></body></html>",
					elements: [],
				}),
			}
			await callback(mockPage)
			return {
				logs: "Navigated to https://example.com after retry due to timeout",
				textContent: "Example Page Retry successful.",
				currentUrl: "https://example.com",
				interactiveElements: [],
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "launch", url: "https://example.com" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify navigation retry logic
		expect(mockTask.browserSession.doAction).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Retry successful"))
	})

	it("should handle page reload with retry mechanism", async () => {
		// Mock model that does not support images for text-based browsing
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.navigateToUrl = jest.fn().mockImplementation(async (url) => {
			return {
				screenshot: "base64-screenshot-data",
				logs: "Page reloaded with retry mechanism",
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "launch", url: "https://example.com" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify page reload with retry
		expect(mockTask.browserSession.doAction).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("The browser action has been executed using text-based browsing"),
		)
	})

	it("should log detailed error messages for failed navigation", async () => {
		// Mock model that doesn't support images
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.doAction = jest
			.fn()
			.mockRejectedValue(new Error("Navigation failed due to network issue"))

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "launch", url: "https://example.com" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify detailed error logging
		expect(mockHandleError).toHaveBeenCalledWith(
			"executing browser action",
			expect.objectContaining({ message: expect.stringContaining("Navigation failed due to network issue") }),
		)
	})

	it("should handle scroll_down action in text-based mode", async () => {
		// Mock model that doesn't support images
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.doAction = jest.fn().mockImplementation(async (callback) => {
			const mockPage = {
				evaluate: jest.fn().mockResolvedValue({
					content: "<html><body><h1>Scrolled Page</h1><p>Content after scroll down.</p></body></html>",
					elements: [],
				}),
			}
			await callback(mockPage)
			return {
				logs: "Scrolled down on the page. Page updated.",
				textContent: "Scrolled Page Content after scroll down.",
				currentUrl: "https://example.com",
				interactiveElements: [],
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "scroll_down" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify scroll_down action
		expect(mockTask.browserSession.doAction).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Page was scrolled down programmatically"),
		)
	})

	it("should handle scroll_up action in text-based mode", async () => {
		// Mock model that doesn't support images
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.doAction = jest.fn().mockImplementation(async (callback) => {
			const mockPage = {
				evaluate: jest.fn().mockResolvedValue({
					content: "<html><body><h1>Scrolled Page</h1><p>Content after scroll up.</p></body></html>",
					elements: [],
				}),
			}
			await callback(mockPage)
			return {
				logs: "Scrolled up on the page. Page updated.",
				textContent: "Scrolled Page Content after scroll up.",
				currentUrl: "https://example.com",
				interactiveElements: [],
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "scroll_up" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify scroll_up action
		expect(mockTask.browserSession.doAction).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Page was scrolled up programmatically"),
		)
	})

	it("should handle hover action in text-based mode", async () => {
		// Mock model that doesn't support images
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.doAction = jest.fn().mockImplementation(async (callback) => {
			const mockPage = {
				evaluate: jest.fn().mockResolvedValue({
					content: "<html><body><h1>Hovered Element</h1><p>Content after hover.</p></body></html>",
					elements: [
						{
							type: "button",
							selector: "#hover-btn",
							text: "Hover Me",
							description: "Button: Hover Me (#hover-btn)",
						},
					],
				}),
			}
			await callback(mockPage)
			return {
				logs: 'Hovered over element with selector "#hover-btn". Page updated.',
				textContent: "Hovered Element Content after hover.",
				currentUrl: "https://example.com",
				interactiveElements: [
					{
						type: "button",
						selector: "#hover-btn",
						text: "Hover Me",
						description: "Button: Hover Me (#hover-btn)",
					},
				],
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "hover", coordinate: "#hover-btn" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify hover action
		expect(mockTask.browserSession.doAction).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Element was hovered over programmatically"),
		)
	})
	it("should handle back action in text-based mode", async () => {
		// Mock model that doesn't support images
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.goBack = jest.fn().mockImplementation(async () => {
			return {
				logs: "Navigated back in browser history. Page updated.",
				textContent: "Previous Page Content",
				currentUrl: "https://example.com/previous",
				interactiveElements: [],
			}
		})
		mockTask.browserSession.doAction = jest.fn().mockImplementation(async (callback) => {
			const mockPage = {
				evaluate: jest.fn().mockResolvedValue({
					content: "<html><body><h1>Previous Page</h1><p>Content after navigating back.</p></body></html>",
					elements: [],
				}),
			}
			await callback(mockPage)
			return {
				logs: "Navigated back in browser history. Page updated.",
				textContent: "Previous Page Content after navigating back.",
				currentUrl: "https://example.com/previous",
				interactiveElements: [],
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "back" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify back action
		expect(mockTask.browserSession.goBack).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Navigated back in browser history programmatically"),
		)
	})

	it("should handle forward action in text-based mode", async () => {
		// Mock model that doesn't support images
		mockTask.api.getModel = jest.fn().mockReturnValue({
			info: { supportsImages: false },
		})

		mockAskApproval.mockResolvedValue(true)
		mockTask.say = jest.fn().mockResolvedValue(undefined)
		mockTask.browserSession.goForward = jest.fn().mockImplementation(async () => {
			return {
				logs: "Navigated forward in browser history. Page updated.",
				textContent: "Next Page Content",
				currentUrl: "https://example.com/next",
				interactiveElements: [],
			}
		})
		mockTask.browserSession.doAction = jest.fn().mockImplementation(async (callback) => {
			const mockPage = {
				evaluate: jest.fn().mockResolvedValue({
					content: "<html><body><h1>Next Page</h1><p>Content after navigating forward.</p></body></html>",
					elements: [],
				}),
			}
			await callback(mockPage)
			return {
				logs: "Navigated forward in browser history. Page updated.",
				textContent: "Next Page Content after navigating forward.",
				currentUrl: "https://example.com/next",
				interactiveElements: [],
			}
		})

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "browser_action",
			params: { action: "forward" },
			partial: false,
		}

		await browserActionTool(
			mockTask,
			toolUse,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify forward action
		expect(mockTask.browserSession.goForward).toHaveBeenCalled()
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Navigated forward in browser history programmatically"),
		)
	})
})
