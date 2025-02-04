import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import ApipieModelPicker from "./ApipieModelPicker"
import { normalizeApiConfiguration } from "./ApiOptions"

const ApipieToolbar = () => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [isClearing, setIsClearing] = useState(false)

	const updateConfiguration = (updates: Partial<typeof apiConfiguration>) => {
		const newConfig = {
			...apiConfiguration,
			...updates,
		}
		setApiConfiguration(newConfig)
		// Sync changes with extension
		vscode.postMessage({
			type: "apiConfiguration",
			apiConfiguration: newConfig,
		})
	}

	const handleIntegrityChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const isChecked = event.target.checked
		updateConfiguration({
			...apiConfiguration,
			apipieIntegrity: isChecked ? 12 : 11,
		})
	}

	const handleMemoryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const isChecked = event.target.checked
		updateConfiguration({
			...apiConfiguration,
			apipieMemory: isChecked,
		})
	}

	const handleClearMemory = () => {
		setIsClearing(true)
		const sessionId = apiConfiguration?.apipieMemorySession || "cline-1"
		vscode.postMessage({
			type: "clearMemory",
			text: sessionId,
		})
		vscode.postMessage({
			type: "showInformationMessage",
			text: `Clearing memory for session ${sessionId}...`,
		})
		setTimeout(() => setIsClearing(false), 2000)
	}

	return (
		<div
			style={{
				display: "block",
				width: "100%",
				marginBottom: "20px",
				paddingRight: "13px",
			}}>
			<div style={{ width: "100%", marginBottom: "5px" }}>
				<ApipieModelPicker showModelDetails={false} />
			</div>

			<div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "center" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
					<span
						style={{ fontSize: "12px" }}
						title="Return the best of two answers, improve your accuracy, eliminate hallucinations.">
						Integrity:
					</span>
					<label className="rocker-switch">
						<input
							type="checkbox"
							checked={apiConfiguration?.apipieIntegrity === 12}
							onChange={handleIntegrityChange}
							style={{ display: "none" }}
						/>
						<div className="rocker-switch-track">
							<div className="rocker-switch-thumb" />
						</div>
					</label>
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
					<span style={{ fontSize: "12px" }} title="enable integrated model memory with any model on APIpie">
						Memory:
					</span>
					<label className="rocker-switch">
						<input
							type="checkbox"
							checked={Boolean(apiConfiguration?.apipieMemory ?? true)}
							onChange={handleMemoryChange}
							style={{ display: "none" }}
						/>
						<div className="rocker-switch-track">
							<div className="rocker-switch-thumb" />
						</div>
					</label>
				</div>

				<VSCodeButton
					appearance="secondary"
					style={{
						backgroundColor: isClearing ? "#225722" : "#5e091ef3",
						border: "none",
						outline: "none",
						boxShadow: "none",
						color: "white",
						padding: "2px 8px",
						fontSize: "12px",
						height: "15px",
						lineHeight: "15px",
						maxHeight: "15px",
						alignItems: "center",
						clipPath:
							"polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px)",
					}}
					title="Clear all memory for the current session"
					onClick={handleClearMemory}>
					{isClearing ? "clearing" : "clear"}
				</VSCodeButton>
			</div>
		</div>
	)
}

export default ApipieToolbar
