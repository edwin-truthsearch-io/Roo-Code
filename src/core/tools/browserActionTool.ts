import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import {
	BrowserAction,
	BrowserActionResult,
	browserActions,
	ClineSayBrowserAction,
	InteractiveElement,
} from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"

// Helper function to analyze page for text-based browsing
async function analyzePageForTextBrowsing(
	page: any,
): Promise<{ content: string; elements: InteractiveElement[]; isSecurityBlock?: boolean }> {
	try {
		// Extract both content and interactive elements from the same page instance
		const result = await page.evaluate(() => {
			// Get page content and clean it up
			const content = document.documentElement.outerHTML || ""

			// Extract interactive elements
			const elements: any[] = []

			// Function to generate robust selectors with XPath fallback
			const generateRobustSelector = (el: Element, index: number, tag: string): string => {
				if (el.id) return `#${el.id}`
				if (el.getAttribute("name")) return `${tag}[name="${el.getAttribute("name")}"]`
				if (el.className) {
					const classes = el.className
						.split(" ")
						.filter((c) => c && !c.startsWith("ng-") && !c.startsWith("js-"))
					if (classes.length > 0) return `.${classes[0]}`
				}
				if (el.getAttribute("data-id")) return `${tag}[data-id="${el.getAttribute("data-id")}"]`
				if (el.getAttribute("data-test-id")) return `${tag}[data-test-id="${el.getAttribute("data-test-id")}"]`
				if (el.getAttribute("data-testid")) return `${tag}[data-testid="${el.getAttribute("data-testid")}"]`
				const text = el.textContent?.trim()
				if (text && text.length > 0 && text.length < 30) return `${tag}:contains("${text}")`
				// Fallback to XPath if no unique CSS selector is found
				try {
					const xpath = `//${tag}[${index + 1}]`
					return `xpath:${xpath}`
				} catch (e) {
					return `${tag}:nth-of-type(${index + 1})`
				}
			}

			// Find buttons
			document.querySelectorAll("button").forEach((btn, index) => {
				const text = btn.textContent?.trim() || ""
				const selector = generateRobustSelector(btn, index, "button")
				elements.push({
					type: "button",
					selector,
					text,
					description: `Button: "${text}" (${selector})`,
				})
			})

			// Find links
			document.querySelectorAll("a[href]").forEach((link, index) => {
				const text = link.textContent?.trim() || ""
				const href = link.getAttribute("href") || ""
				const selector = generateRobustSelector(link, index, "a")
				elements.push({
					type: "link",
					selector,
					text,
					href,
					description: `Link: "${text}" -> ${href} (${selector})`,
				})
			})

			// Find input fields
			document.querySelectorAll("input").forEach((input, index) => {
				const type = input.type || "text"
				const placeholder = input.placeholder || ""
				const name = input.name || ""
				const selector = generateRobustSelector(input, index, "input")
				elements.push({
					type: "input",
					selector,
					placeholder,
					description: `Input (${type}): ${name || placeholder || "unnamed"} (${selector})`,
				})
			})

			// Find textareas
			document.querySelectorAll("textarea").forEach((textarea, index) => {
				const placeholder = textarea.placeholder || ""
				const name = textarea.name || ""
				const selector = generateRobustSelector(textarea, index, "textarea")
				elements.push({
					type: "textarea",
					selector,
					placeholder,
					description: `Textarea: ${name || placeholder || "unnamed"} (${selector})`,
				})
			})

			// Check for security block indicators (e.g., Cloudflare)
			const isSecurityBlock =
				content.includes("Cloudflare") ||
				content.includes("Attention Required") ||
				content.includes("Security Check") ||
				content.includes("captcha")

			return { content, elements, isSecurityBlock }
		})

		// Enhanced HTML cleaning before markdown conversion
		let cleanContent = result.content || ""
		if (cleanContent) {
			cleanContent = cleanContent
				.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
				.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
				.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
				.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
				.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
				.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
		}

		// Enhanced HTML to markdown conversion
		const textContent = cleanContent
			? convertHtmlToMarkdown(cleanContent)
			: "Error: No content available for conversion."

		return { content: textContent, elements: result.elements, isSecurityBlock: result.isSecurityBlock }
	} catch (error) {
		console.error("Error analyzing page for text browsing:", error)
		// Log detailed error information for debugging
		const detailedError = await page
			.evaluate(() => {
				return {
					errorMessage: String(error),
					pageTitle: document.title || "No title",
					pageUrl: window.location.href,
					domSnippet:
						document.body.innerHTML.substring(0, 200) + (document.body.innerHTML.length > 200 ? "..." : ""),
				}
			})
			.catch(() => ({
				errorMessage: String(error),
				pageTitle: "Unknown",
				pageUrl: "Unknown",
				domSnippet: "Unable to retrieve DOM",
			}))

		console.error("Detailed page state on error:", detailedError)
		return {
			content: `Error analyzing page: ${error.message}\n\nDetailed State:\n- Page Title: ${detailedError.pageTitle}\n- URL: ${detailedError.pageUrl}\n- DOM Snippet: ${detailedError.domSnippet}`,
			elements: [],
			isSecurityBlock: false,
		}
	}
}

// Helper function to convert HTML to markdown for better readability
function convertHtmlToMarkdown(html: string): string {
	// Basic HTML to markdown conversion logic
	// Replace headings
	html = html.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
	html = html.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
	html = html.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")

	// Replace paragraphs and line breaks
	html = html.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
	html = html.replace(/<br\s*\/?>/gi, "\n")

	// Replace links
	html = html.replace(/<a\s+[^>]*href=["'](.*?)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)")

	// Replace lists
	html = html.replace(/<ul[^>]*>(.*?)<\/ul>/gi, "$1\n")
	html = html.replace(/<ol[^>]*>(.*?)<\/ol>/gi, "$1\n")
	html = html.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1")

	// Replace bold and italic
	html = html.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
	html = html.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
	html = html.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
	html = html.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")

	// Remove remaining HTML tags
	html = html.replace(/<[^>]*>/g, "")

	// Normalize whitespace
	html = html.replace(/\s+/g, " ").trim()

	return html
}

export async function browserActionTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const action: BrowserAction | undefined = block.params.action as BrowserAction
	const url: string | undefined = block.params.url
	const coordinate: string | undefined = block.params.coordinate
	const text: string | undefined = block.params.text
	const size: string | undefined = block.params.size

	if (!action || !browserActions.includes(action)) {
		// checking for action to ensure it is complete and valid
		if (!block.partial) {
			// if the block is complete and we don't have a valid action cline is a mistake
			cline.consecutiveMistakeCount++
			cline.recordToolError("browser_action")
			pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "action"))
			await cline.browserSession.closeBrowser()
		}

		return
	}

	try {
		if (block.partial) {
			if (action === "launch") {
				await cline.ask("browser_action_launch", removeClosingTag("url", url), block.partial).catch(() => {})
			} else {
				await cline.say(
					"browser_action",
					JSON.stringify({
						action: action as BrowserAction,
						coordinate: removeClosingTag("coordinate", coordinate),
						text: removeClosingTag("text", text),
					} satisfies ClineSayBrowserAction),
					undefined,
					block.partial,
				)
			}
			return
		} else {
			// Initialize with empty object to avoid "used before assigned" errors
			let browserActionResult: BrowserActionResult = {}

			if (action === "launch") {
				if (!url) {
					cline.consecutiveMistakeCount++
					cline.recordToolError("browser_action")
					pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "url"))
					await cline.browserSession.closeBrowser()
					return
				}

				cline.consecutiveMistakeCount = 0
				const didApprove = await askApproval("browser_action_launch", url)

				if (!didApprove) {
					return
				}

				// Check model capabilities to determine browsing method
				const modelSupportsImages = cline.api.getModel().info.supportsImages ?? false
				const modelSupportsComputerUse = cline.api.getModel().info.supportsComputerUse ?? false

				if (modelSupportsImages) {
					// Use visual browser session for models that support images
					await cline.say("browser_action_result", "") // Starts loading spinner

					await cline.browserSession.launchBrowser(modelSupportsImages, modelSupportsComputerUse)
					browserActionResult = await cline.browserSession.navigateToUrl(url)
				} else {
					// Use text-based browsing for models that don't support images
					try {
						// Pass model capabilities to browser session
						await cline.browserSession.launchBrowser(modelSupportsImages, modelSupportsComputerUse)

						// Navigate to the URL and extract both content and interactive elements
						let pageAnalysis: {
							content: string
							elements: InteractiveElement[]
							isSecurityBlock?: boolean
						} = {
							content: "Error: Page content initialization failed.",
							elements: [],
							isSecurityBlock: false,
						}

						await cline.browserSession.doAction(async (page) => {
							await page
								.goto(url, { timeout: 15_000, waitUntil: ["domcontentloaded", "networkidle2"] })
								.catch(async (err) => {
									console.error("Navigation error:", err)
									// Fallback to a shorter timeout and less strict wait conditions
									await page
										.goto(url, { timeout: 10_000, waitUntil: "domcontentloaded" })
										.catch((err2) => {
											console.error("Fallback navigation error:", err2)
											throw new Error(`Failed to navigate to ${url}: ${err2.message}`)
										})
								})

							// Extract text content and interactive elements with multiple retries
							for (let attempt = 1; attempt <= 3; attempt++) {
								const analysisResult = await analyzePageForTextBrowsing(page)
								if (analysisResult.isSecurityBlock) {
									pageAnalysis.content =
										"Security block detected (e.g., Cloudflare). Retrying navigation..."
									await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
									if (attempt < 3) {
										await page
											.reload({
												timeout: 10_000,
												waitUntil: ["domcontentloaded", "networkidle2"],
											})
											.catch(() => {
												console.log("Retry reload due to security block failed, continuing.")
											})
									}
								} else if (analysisResult.content || analysisResult.elements.length > 0) {
									pageAnalysis = analysisResult
									break
								} else {
									pageAnalysis.content = `Page content could not be loaded. Retrying (${attempt}/3)...`
									await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
								}
							}
							if (!pageAnalysis.content) {
								pageAnalysis.content =
									"Error: Page content could not be loaded after multiple retries. Attempting fallback extraction..."
								// Fallback to a simpler content extraction method
								const fallbackContent = await page.evaluate(
									() => document.body.innerText || "No content available.",
								)
								if (fallbackContent) {
									pageAnalysis.content = `Fallback content extracted:\n\n${fallbackContent.substring(0, 1000)}...`
								} else {
									pageAnalysis.content =
										"Error: No content could be extracted even with fallback method."
								}
							}
						})

						const modeDescription = "text-based browsing (model does not support images)"

						browserActionResult = {
							logs: `Navigated to ${url} using ${modeDescription}`,
							screenshot: undefined,
							textContent: pageAnalysis.content,
							currentUrl: url,
							interactiveElements: pageAnalysis.elements,
						}
					} catch (error) {
						// Attempt a fallback content fetch if navigation fails repeatedly
						try {
							console.error("Navigation failed, attempting fallback content fetch:", error)
							let fallbackContent = ""
							await cline.browserSession.doAction(async (page) => {
								fallbackContent = await page.evaluate(() => {
									return fetch(window.location.href)
										.then((response) => response.text())
										.catch(() => document.body.innerText || "No content available via fallback.")
								})
							})
							if (fallbackContent) {
								const fallbackPageAnalysis = {
									content: `Fallback content fetched:\n\n${fallbackContent.substring(0, 1000)}...`,
									elements: [],
									isSecurityBlock: false,
								}
								browserActionResult = {
									logs: `Navigated to ${url} using text-based browsing with fallback fetch.`,
									screenshot: undefined,
									textContent: fallbackPageAnalysis.content,
									currentUrl: url,
									interactiveElements: fallbackPageAnalysis.elements,
								}
							} else {
								await cline.browserSession.closeBrowser()
								throw new Error(
									`Failed during browser launch or navigation, and fallback fetch failed: ${error.message}`,
								)
							}
						} catch (fallbackError) {
							await cline.browserSession.closeBrowser()
							throw new Error(
								`Failed during browser launch or navigation, and fallback fetch failed: ${fallbackError.message}`,
							)
						}
					}
				}
			} else {
				// Check model capabilities for non-launch actions
				const modelSupportsImages = cline.api.getModel().info.supportsImages ?? false
				const modelSupportsComputerUse = cline.api.getModel().info.supportsComputerUse ?? false

				// For text-based browsing, we support enhanced programmatic interaction
				if (!modelSupportsImages && action !== "close") {
					if (action === "click") {
						if (!coordinate) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "coordinate"))
							return
						}

						try {
							// For text-based browsing, coordinate should be a CSS selector
							const selector = coordinate

							// Perform the click action and get updated page analysis
							let pageAnalysis: { content: string; elements: InteractiveElement[] } = {
								content: "Error: Page content initialization failed after click.",
								elements: [],
							}
							const clickResult = await cline.browserSession.doAction(async (page) => {
								await page.click(selector).catch(async (err) => {
									console.error("Click error:", err)
									throw new Error(
										`Failed to click element with selector "${selector}": ${err.message}`,
									)
								})
								// Get updated page state after the action with retries
								for (let attempt = 1; attempt <= 3; attempt++) {
									const analysisResult = await analyzePageForTextBrowsing(page)
									if (analysisResult.content || analysisResult.elements.length > 0) {
										pageAnalysis = analysisResult
										break
									}
									pageAnalysis.content = `Page content could not be loaded after click. Retrying (${attempt}/3)...`
									await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
								}
								if (!pageAnalysis.content) {
									pageAnalysis.content =
										"Error: Page content could not be loaded after click retries. Attempting fallback extraction..."
									const fallbackContent = await page.evaluate(
										() => document.body.innerText || "No content available.",
									)
									if (fallbackContent) {
										pageAnalysis.content = `Fallback content extracted after click:\n\n${fallbackContent.substring(0, 1000)}...`
									} else {
										pageAnalysis.content =
											"Error: No content could be extracted even with fallback method after click."
									}
								}
							})

							const currentUrl = clickResult.currentUrl || url || ""

							browserActionResult = {
								logs: `Clicked element with selector "${selector}". Page updated.`,
								currentUrl: currentUrl,
								textContent: pageAnalysis!.content,
								interactiveElements: pageAnalysis!.elements,
							}

							// Return result directly for text-based browsing
							pushToolResult(
								formatResponse.toolResult(
									`The browser action has been executed using text-based browsing. Element was clicked programmatically.\n\nConsole logs:\n${
										browserActionResult?.logs || "(No new logs)"
									}\n\nUpdated page content:\n${pageAnalysis!.content}\n\nAvailable interactive elements:\n${pageAnalysis!.elements
										.map((el) => `- ${el.description}`)
										.join(
											"\n",
										)}\n\n(REMEMBER: For text-based browsing, use CSS selectors like "button.submit", "#login-btn", "a[href='/about']" instead of coordinates.)`,
								),
							)
							return
						} catch (error) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							pushToolResult(
								formatResponse.toolResult(
									`Failed to click element: ${error.message}. For text-based browsing, provide a CSS selector (e.g., "button.submit", "#login-btn", "a[href='/about']") instead of coordinates. Ensure the selector is unique and the element is interactable.`,
								),
							)
							return
						}
					} else if (action === "type") {
						if (!coordinate || !text) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							const missingParam = !coordinate ? "coordinate" : "text"
							pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", missingParam))
							return
						}

						try {
							// For text-based browsing, coordinate should be a CSS selector for the input field
							const selector = coordinate

							// Perform the type action and get the result
							const typeResult = await cline.browserSession.doAction(async (page) => {
								await page.type(selector, text)
							})

							browserActionResult = {
								logs: `Typed "${text}" into element with selector "${selector}".`,
								currentUrl: typeResult.currentUrl || url,
							}

							// Return result directly for text-based browsing
							pushToolResult(
								formatResponse.toolResult(
									`The browser action has been executed using text-based browsing. Text was typed programmatically.\n\nConsole logs:\n${
										browserActionResult?.logs || "(No new logs)"
									}\n\n(REMEMBER: For text-based browsing, use CSS selectors like "input[name='username']", "#password", "textarea.comment" for the coordinate parameter.)`,
								),
							)
							return
						} catch (error) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							pushToolResult(
								formatResponse.toolResult(
									`Failed to type into element: ${error.message}. For text-based browsing, provide a CSS selector for the input field (e.g., "input[name='username']", "#password", "textarea.comment") in the coordinate parameter. Ensure the selector targets an existing input field.`,
								),
							)
							return
						}
					} else if (action === "scroll_down" || action === "scroll_up") {
						try {
							// Perform the scroll action and get updated page analysis
							let pageAnalysis: { content: string; elements: InteractiveElement[] } = {
								content: "Error: Page content initialization failed after scroll.",
								elements: [],
							}
							const scrollResult = await cline.browserSession.doAction(async (page) => {
								await page.evaluate((scrollAction) => {
									const height = window.innerHeight
									const scrollAmount = scrollAction === "scroll_down" ? height : -height
									window.scrollBy({
										top: scrollAmount,
										behavior: "auto",
									})
								}, action)
								// Small delay to allow content to load after scroll
								await new Promise((resolve) => setTimeout(resolve, 500))
								// Get updated page state after the action with retries
								for (let attempt = 1; attempt <= 3; attempt++) {
									const analysisResult = await analyzePageForTextBrowsing(page)
									if (analysisResult.content || analysisResult.elements.length > 0) {
										pageAnalysis = analysisResult
										break
									}
									pageAnalysis.content = `Page content could not be loaded after scroll. Retrying (${attempt}/3)...`
									await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
								}
								if (!pageAnalysis.content) {
									pageAnalysis.content =
										"Error: Page content could not be loaded after scroll retries. Attempting fallback extraction..."
									const fallbackContent = await page.evaluate(
										() => document.body.innerText || "No content available.",
									)
									if (fallbackContent) {
										pageAnalysis.content = `Fallback content extracted after scroll:\n\n${fallbackContent.substring(0, 1000)}...`
									} else {
										pageAnalysis.content =
											"Error: No content could be extracted even with fallback method after scroll."
									}
								}
								// No return value to match expected Promise<void>
							})

							const currentUrl = scrollResult.currentUrl || url || ""

							browserActionResult = {
								logs: `Scrolled ${action === "scroll_down" ? "down" : "up"} on the page. Page updated.`,
								currentUrl: currentUrl,
								textContent: pageAnalysis.content,
								interactiveElements: pageAnalysis.elements,
							}

							// Return result directly for text-based browsing
							pushToolResult(
								formatResponse.toolResult(
									`The browser action has been executed using text-based browsing. Page was scrolled ${action === "scroll_down" ? "down" : "up"} programmatically.\n\nConsole logs:\n${
										browserActionResult.logs || "(No new logs)"
									}\n\nUpdated page content:\n${pageAnalysis.content}\n\nAvailable interactive elements:\n${pageAnalysis.elements
										.map((el) => `- ${el.description}`)
										.join(
											"\n",
										)}\n\n(REMEMBER: For text-based browsing, use CSS selectors like "button.submit", "#login-btn", "a[href='/about']" instead of coordinates.)`,
								),
							)
							return
						} catch (error) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							pushToolResult(
								formatResponse.toolResult(
									`Failed to scroll page: ${error.message}. Ensure the browser is open and the page is loaded.`,
								),
							)
							return
						}
					} else if (action === "hover") {
						if (!coordinate) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "coordinate"))
							return
						}
						try {
							// For text-based browsing, coordinate should be a CSS selector
							const selector = coordinate

							// Perform the hover action and get updated page analysis
							let pageAnalysis: { content: string; elements: InteractiveElement[] } = {
								content: "Error: Page content initialization failed after hover.",
								elements: [],
							}
							const hoverResult = await cline.browserSession.doAction(async (page) => {
								await page.evaluate((sel) => {
									const element = document.querySelector(sel)
									if (element) {
										element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
										element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
									}
								}, selector)
								// Small delay to allow hover effects to appear
								await new Promise((resolve) => setTimeout(resolve, 300))
								// Get updated page state after the action with retries
								for (let attempt = 1; attempt <= 3; attempt++) {
									const analysisResult = await analyzePageForTextBrowsing(page)
									if (analysisResult.content || analysisResult.elements.length > 0) {
										pageAnalysis = analysisResult
										break
									}
									pageAnalysis.content = `Page content could not be loaded after hover. Retrying (${attempt}/3)...`
									await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
								}
								if (!pageAnalysis.content) {
									pageAnalysis.content =
										"Error: Page content could not be loaded after hover retries. Attempting fallback extraction..."
									const fallbackContent = await page.evaluate(
										() => document.body.innerText || "No content available.",
									)
									if (fallbackContent) {
										pageAnalysis.content = `Fallback content extracted after hover:\n\n${fallbackContent.substring(0, 1000)}...`
									} else {
										pageAnalysis.content =
											"Error: No content could be extracted even with fallback method after hover."
									}
								}
								// No return value to match expected Promise<void>
							})

							const currentUrl = hoverResult.currentUrl || url || ""

							browserActionResult = {
								logs: `Hovered over element with selector "${selector}". Page updated.`,
								currentUrl: currentUrl,
								textContent: pageAnalysis.content,
								interactiveElements: pageAnalysis.elements,
							}

							// Return result directly for text-based browsing
							pushToolResult(
								formatResponse.toolResult(
									`The browser action has been executed using text-based browsing. Element was hovered over programmatically.\n\nConsole logs:\n${
										browserActionResult.logs || "(No new logs)"
									}\n\nUpdated page content:\n${pageAnalysis.content}\n\nAvailable interactive elements:\n${pageAnalysis.elements
										.map((el) => `- ${el.description}`)
										.join(
											"\n",
										)}\n\n(REMEMBER: For text-based browsing, use CSS selectors like "button.submit", "#login-btn", "a[href='/about']" instead of coordinates.)`,
								),
							)
							return
						} catch (error) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							pushToolResult(
								formatResponse.toolResult(
									`Failed to hover over element: ${error.message}. For text-based browsing, provide a CSS selector (e.g., "button.submit", "#login-btn", "a[href='/about']") instead of coordinates. Ensure the selector is unique and the element is interactable.`,
								),
							)
							return
						}
					} else if (action === "back" || action === "forward") {
						try {
							// Perform the navigation action and get updated page analysis
							let navPageAnalysis: { content: string; elements: InteractiveElement[] } = {
								content: "Error: Page content initialization failed after navigation.",
								elements: [],
							}
							let navigationResult
							if (action === "back") {
								navigationResult = await cline.browserSession.goBack()
							} else {
								navigationResult = await cline.browserSession.goForward()
							}

							await cline.browserSession.doAction(async (page) => {
								// Small delay to allow content to load after navigation
								await new Promise((resolve) => setTimeout(resolve, 500))
								// Get updated page state after the action with retries
								for (let attempt = 1; attempt <= 3; attempt++) {
									const analysisResult = await analyzePageForTextBrowsing(page)
									if (analysisResult.content || analysisResult.elements.length > 0) {
										navPageAnalysis = analysisResult
										break
									}
									navPageAnalysis.content = `Page content could not be loaded after navigation. Retrying (${attempt}/3)...`
									await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
								}
								if (!navPageAnalysis.content) {
									navPageAnalysis.content =
										"Error: Page content could not be loaded after navigation retries. Attempting fallback extraction..."
									const fallbackContent = await page.evaluate(
										() => document.body.innerText || "No content available.",
									)
									if (fallbackContent) {
										navPageAnalysis.content = `Fallback content extracted after navigation:\n\n${fallbackContent.substring(0, 1000)}...`
									} else {
										navPageAnalysis.content =
											"Error: No content could be extracted even with fallback method after navigation."
									}
								}
							})

							const currentUrl = navigationResult.currentUrl || url || ""

							browserActionResult = {
								logs: `Navigated ${action === "back" ? "back" : "forward"} in browser history. Page updated.`,
								currentUrl: currentUrl,
								textContent: navPageAnalysis.content,
								interactiveElements: navPageAnalysis.elements,
							}

							// Return result directly for text-based browsing
							pushToolResult(
								formatResponse.toolResult(
									`The browser action has been executed using text-based browsing. Navigated ${action === "back" ? "back" : "forward"} in browser history programmatically.\n\nConsole logs:\n${
										browserActionResult.logs || "(No new logs)"
									}\n\nUpdated page content:\n${navPageAnalysis.content}\n\nAvailable interactive elements:\n${navPageAnalysis.elements
										.map((el) => `- ${el.description}`)
										.join(
											"\n",
										)}\n\n(REMEMBER: For text-based browsing, use CSS selectors like "button.submit", "#login-btn", "a[href='/about']" instead of coordinates.)`,
								),
							)
							return
						} catch (error) {
							cline.consecutiveMistakeCount++
							cline.recordToolError("browser_action")
							pushToolResult(
								formatResponse.toolResult(
									`Failed to navigate ${action === "back" ? "back" : "forward"}: ${error.message}. Ensure the browser is open and there is history to navigate.`,
								),
							)
							return
						}
					} else {
						// Other actions not supported for text-based browsing
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						pushToolResult(
							formatResponse.toolResult(
								`The action "${action}" is not supported for text-based browsing (model does not support images). Supported actions: "launch" (to fetch page content), "click" (using CSS selectors), "type" (using CSS selectors), "scroll_down", "scroll_up", "hover" (using CSS selectors), "back", "forward", and "close".`,
							),
						)
						return
					}
				}

				if (action === "click" || action === "hover") {
					if (!coordinate) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "coordinate"))
						await cline.browserSession.closeBrowser()
						return // can't be within an inner switch
					}
				}

				if (action === "type") {
					if (!text) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "text"))
						await cline.browserSession.closeBrowser()
						return
					}
				}

				if (action === "resize") {
					if (!size) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "size"))
						await cline.browserSession.closeBrowser()
						return
					}
				}

				cline.consecutiveMistakeCount = 0

				await cline.say(
					"browser_action",
					JSON.stringify({
						action: action as BrowserAction,
						coordinate,
						text,
					} satisfies ClineSayBrowserAction),
					undefined,
					false,
				)

				switch (action) {
					case "click":
						browserActionResult = await cline.browserSession.click(coordinate!)
						break
					case "hover":
						browserActionResult = await cline.browserSession.hover(coordinate!)
						break
					case "type":
						browserActionResult = await cline.browserSession.type(text!)
						break
					case "scroll_down":
						browserActionResult = await cline.browserSession.scrollDown()
						break
					case "scroll_up":
						browserActionResult = await cline.browserSession.scrollUp()
						break
					case "resize":
						browserActionResult = await cline.browserSession.resize(size!)
						break
					case "back":
						browserActionResult = await cline.browserSession.goBack()
						break
					case "forward":
						browserActionResult = await cline.browserSession.goForward()
						break
					case "close":
						browserActionResult = await cline.browserSession.closeBrowser()
						break
				}
			}

			switch (action) {
				case "launch":
				case "click":
				case "hover":
				case "type":
				case "scroll_down":
				case "scroll_up":
				case "resize":
				case "back":
				case "forward": {
					// Check if we have text content (text-based browsing) or screenshot (visual browsing)
					const hasTextContent = (browserActionResult as any)?.textContent
					const hasScreenshot = browserActionResult?.screenshot

					if (hasTextContent) {
						// Text-based browsing result
						const interactiveElements = (browserActionResult as any)?.interactiveElements || []
						const elementsText =
							interactiveElements.length > 0
								? `\n\nAvailable interactive elements:\n${interactiveElements.map((el: any) => `- ${el.description}`).join("\n")}`
								: ""

						pushToolResult(
							formatResponse.toolResult(
								`The browser action has been executed using text-based browsing. The page content has been converted to markdown for your analysis.\n\nConsole logs:\n${
									browserActionResult?.logs || "(No new logs)"
								}\n\nPage content (markdown):\n${(browserActionResult as any).textContent}${elementsText}\n\n(REMEMBER: For text-based browsing, use CSS selectors like "button.submit", "#login-btn", "a[href='/about']" instead of coordinates. If you need to proceed to using non-\`browser_action\` tools, you MUST first close the browser.)`,
							),
						)
					} else {
						// Visual browsing result (original behavior)
						await cline.say("browser_action_result", JSON.stringify(browserActionResult))
						pushToolResult(
							formatResponse.toolResult(
								`The browser action has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${
									browserActionResult?.logs || "(No new logs)"
								}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close cline browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`,
								hasScreenshot && browserActionResult.screenshot ? [browserActionResult.screenshot] : [],
							),
						)
					}

					break
				}
				case "close":
					pushToolResult(
						formatResponse.toolResult(
							`The browser has been closed. You may now proceed to using other tools.`,
						),
					)

					break
			}

			return
		}
	} catch (error) {
		// Clean up browser session if any error occurs
		await cline.browserSession.closeBrowser()
		await handleError("executing browser action", error)
		return
	}
}
