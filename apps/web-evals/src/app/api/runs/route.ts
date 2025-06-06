import { NextRequest, NextResponse } from "next/server"

import { createRun, deleteRun } from "@/actions/runs"

export async function POST(request: NextRequest) {
	try {
		const body = await request.json()
		const run = await createRun(body)
		return NextResponse.json(run)
	} catch (error) {
		console.error("Error creating run:", error)
		return NextResponse.json({ error: "Failed to create run" }, { status: 500 })
	}
}

export async function DELETE(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url)
		const runId = searchParams.get("runId")

		if (!runId) {
			return NextResponse.json({ error: "runId is required" }, { status: 400 })
		}

		await deleteRun(parseInt(runId, 10))
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error("Error deleting run:", error)
		return NextResponse.json({ error: "Failed to delete run" }, { status: 500 })
	}
}
