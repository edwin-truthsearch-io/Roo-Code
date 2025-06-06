import { NextRequest, NextResponse } from "next/server"

import { getTasks } from "@/actions/tasks"

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url)
		const runId = searchParams.get("runId")

		if (!runId) {
			return NextResponse.json({ error: "runId is required" }, { status: 400 })
		}

		const tasks = await getTasks(parseInt(runId, 10))
		return NextResponse.json(tasks)
	} catch (error) {
		console.error("Error getting tasks:", error)
		return NextResponse.json({ error: "Failed to get tasks" }, { status: 500 })
	}
}
