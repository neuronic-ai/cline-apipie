import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { highlight } from "../history/HistoryView"
import { ModelInfoView, normalizeApiConfiguration } from "./ApiOptions"

const defaultProvider = "openai"
const defaultModel = "gpt-4o"

interface ApipieModelPickerProps {
	showModelDetails?: boolean
}

const ApipieModelPicker: React.FC<ApipieModelPickerProps> = ({ showModelDetails = true }) => {
	const { apiConfiguration, setApiConfiguration, apipieModels } = useExtensionState()
	const [searchTerm, setSearchTerm] = useState(apiConfiguration?.apiModelId || `${defaultProvider}/${defaultModel}`)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	useMount(() => {
		vscode.postMessage({ type: "refreshApipieModels" })
	})

	useEffect(() => {
		if (apipieModels && !apipieModels[searchTerm]) {
			handleModelChange(Object.keys(apipieModels)[0] || `${defaultProvider}/${defaultModel}`)
		}
	}, [apipieModels])

	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	// Simple model selection handler - matches OpenAI module pattern
	const handleModelChange = (newModelId: string) => {
		const newConfig = {
			...apiConfiguration,
			apiProvider: "apipie" as const,
			apiModelId: newModelId
		}
		setApiConfiguration(newConfig)
		// Sync changes with extension
		vscode.postMessage({
			type: "apiConfiguration",
			apiConfiguration: newConfig,
		})
		setSearchTerm(newModelId)
	}

	// Separate handler for search functionality
	const handleSearchInput = (value: string) => {
		setSearchTerm(value)
		setIsDropdownVisible(true)
	}

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	const searchableItems = useMemo(() => {
		return Object.keys(apipieModels || {}).map((id) => ({
			id,
			html: id,
		}))
	}, [apipieModels])

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["html"],
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [searchableItems])

	const modelSearchResults = useMemo(() => {
		let results: { id: string; html: string }[] = searchTerm
			? highlight(fuse.search(searchTerm), "model-item-highlight")
			: searchableItems
		return results
	}, [searchableItems, searchTerm, fuse])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible || modelSearchResults.length === 0) return

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					handleModelChange(modelSearchResults[selectedIndex].id)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	return (
		<>
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div>
				<label htmlFor="model-search">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>
				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						placeholder="Search and select a model..."
						value={searchTerm}
						onInput={(e) => {
							handleSearchInput((e.target as HTMLInputElement)?.value?.toLowerCase())
							setIsDropdownVisible(true)
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onKeyDown={handleKeyDown}
						style={{ width: "100%", zIndex: APIPIE_MODEL_PICKER_Z_INDEX, position: "relative" }}>
						{searchTerm && (
							<div
								className="input-icon-button codicon codicon-close"
								aria-label="Clear search"
								onClick={() => {
									handleSearchInput("")
									setIsDropdownVisible(true)
								}}
								slot="end"
								style={{
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									height: "100%",
								}}
							/>
						)}
					</VSCodeTextField>
					{isDropdownVisible && (
						<DropdownList ref={dropdownListRef}>
							{modelSearchResults.map((item, index) => (
								<DropdownItem
									key={item.id}
									ref={(el) => (itemRefs.current[index] = el)}
									isSelected={index === selectedIndex}
									onMouseEnter={() => setSelectedIndex(index)}
									onClick={() => {
										handleModelChange(item.id)
										setIsDropdownVisible(false)
									}}
									dangerouslySetInnerHTML={{
										__html: item.html,
									}}
								/>
							))}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>

			{showModelDetails && (
				<>
					{selectedModelInfo ? (
						<ModelInfoView
							selectedModelId={selectedModelId}
							modelInfo={selectedModelInfo}
							isDescriptionExpanded={isDescriptionExpanded}
							setIsDescriptionExpanded={setIsDescriptionExpanded}
						/>
					) : (
						<p style={{ fontSize: "12px", marginTop: 0, color: "var(--vscode-descriptionForeground)" }}>
							Select a model from the dropdown above.
						</p>
					)}
				</>
			)}
		</>
	)
}

export default ApipieModelPicker

// Dropdown

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

export const APIPIE_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${APIPIE_MODEL_PICKER_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`

const DropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`
