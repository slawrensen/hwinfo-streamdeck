/**
 * The English string catalog: the one source for every runtime string that
 * goes through t() (src/i18n.ts, the EN object) and for the panel strings
 * that go through hwT() (ui/pi-strings.js, the PANEL object). `npm run l10n`
 * writes EN into the Localization block of
 * com.lawrensen.hwinfo.sdPlugin/en.json and PANEL into ui/pi-strings.js;
 * test/i18n.test.ts fails when either file drifts from these objects.
 *
 * Keys are dotted paths into this object, the shape the Stream Deck SDK's
 * i18n lookup reads. Leaves are strings only. A `{name}` in a value is a
 * parameter t() fills in.
 *
 * English only in 1.8.0 (docs/localization.md): a new language needs a
 * named human reviewer. Numbers stay '.'-decimal in every language, so the
 * face width math and the panel's parsing stay the same.
 *
 * The lone em dash a face draws for "no value" is a glyph, not a word, and
 * stays in the code. So do brand and product names (HWiNFO).
 */
export const EN = {
	/** Key faces for a state with no value: a headline and a dim hint. */
	face: {
		staleGadget: { title: "Age unknown", hint: "check Gadget" },
		staleShared: { title: "Not updating", hint: "check sharing" },
		notRunning: { title: "Start HWiNFO", hint: "not detected" },
		busy: { title: "Source busy", hint: "retrying" },
		gadgetEmpty: { title: "Tick sensors", hint: "in Gadget" },
		disabled: { title: "Shared Memory", hint: "is off" },
		accessDenied: { title: "Access denied", hint: "open settings" },
		unsupported: { title: "Needs x64", hint: "Windows" },
		bridgeFailed: { title: "Bridge failed", hint: "reinstall" },
		sourceError: { title: "Source error", hint: "open settings" },
		noSelection: { title: "Pick a sensor", hint: "in settings" },
		missing: { title: "Sensor missing", hint: "pick again" }
	},
	/** Dial touchscreen texts for the same states: a title, a value line and,
	 * where the face has one, a hint. A title is the key face's title for the
	 * same state (test/state-screens.test.ts); disabled and unsupported keep
	 * the key's words split across one line instead of two. */
	dial: {
		staleGadget: { title: "Age unknown", value: "check Gadget" },
		staleShared: { title: "Not updating", value: "check sharing" },
		notRunning: { title: "Start HWiNFO", value: "not detected" },
		busy: { title: "Source busy", value: "retrying" },
		gadgetEmpty: { title: "Tick sensors", value: "in Gadget" },
		disabled: { title: "Shared Memory off", value: "enable in HWiNFO" },
		accessDenied: { title: "Access denied", value: "open settings" },
		unsupported: { title: "Needs x64 Windows" },
		bridgeFailed: { title: "Bridge failed", value: "reinstall it" },
		sourceError: { title: "Source error", value: "open settings" },
		noSelection: { title: "Pick a sensor", value: "rotate to pick", hint: "or use the settings panel" },
		missing: { title: "Sensor missing", value: "waiting", hint: "reselect in settings" }
	},
	/** The stat badge a face shows beside a non-current stat. */
	badge: {
		min: "MIN",
		max: "MAX",
		avg: "AVG",
		unavailable: "N/A"
	},
	/** The settings panel's status sentence under the reading picker. */
	sentence: {
		gadgetOk: "Reading via HWiNFO's Gadget registry (current values only, no min/max/avg). A value change was observed; the registry has no producer timestamp. Auto switches providers; saved keys need explicit reading links to work across sources. Enable Shared Memory Support for stable hardware IDs.",
		gadgetStale: "Gadget freshness is unknown. Unchanged values may be steady readings or left by a killed or crashed HWiNFO. A successful registry read cannot distinguish them. Check HWiNFO and Gadget reporting, or use Shared Memory Support.",
		sharedStale: "No new Shared Memory measurement evidence for {seconds}s. Check HWiNFO and Shared Memory Support; a busy connection can also prevent reads.",
		gadgetWithheldNames: "Gadget rows with an incomplete name are withheld, and so are two ticked readings that share a source name and label (HWiNFO lists some twice, such as a fan in RPM and in percent). Untick or relabel one of the two in HWiNFO and the other comes back on its own.",
		gadgetContradictory: "A Gadget row whose formatted value contradicts its raw value is withheld; the plugin log names the slot.",
		notRunning: "The plugin could not open a sensor feed. Check that HWiNFO is running in Sensors-only mode with Shared Memory Support enabled, or enable Gadget reporting and tick the sensors you need.",
		busy: "The sensor source was busy or changed during a read. The plugin retries automatically. If this persists, choose \"Copy support report\" under Advanced, Support.",
		gadgetEmpty: "The Gadget registry is present but has no readable sensor rows. In HWiNFO, open Configure Sensors and the HWiNFO Gadget tab. Check Enable reporting to Gadget and tick \"Report value in Gadget\" for the readings you need.",
		disabled: "HWiNFO reports Shared Memory Support as disabled. Re-enable it in HWiNFO Settings; the free version switches it off after 12 hours.",
		accessDenied: "Windows denied access needed to read the sensor source. Choose \"Copy support report\" under Advanced, Support. This error alone does not identify which access rule failed.",
		unsupported: "This plugin needs 64-bit (x64) Windows: HWiNFO's interfaces aren't readable on this system (macOS and Windows-on-ARM are unsupported).",
		bridgeFailed: "The native HWiNFO bridge (bin/hwsm.node) could not load. Reinstall the plugin from its release package. If Windows or security software reports a block, keep that report and the package hash for support. A load failure alone does not identify the cause.",
		sourceError: "The sensor source could not be opened or validated. Choose \"Copy support report\" under Advanced, Support."
	},
	/** Words the plugin sends the panel's live preview. */
	preview: {
		unknownSensor: "Unknown sensor",
		statsGadget: "Historical statistics unavailable in Gadget",
		stats: "min {min} · max {max} · avg {avg}"
	},
	/** Strip Display words drawn inside a pane. */
	strip: {
		chooseReadings: "Choose readings in the dial settings",
		lanesNeedSecond: "Lanes needs a second reading",
		compareNeedSecond: "Compare needs a second reading",
		noHistoryRoom: "no history room",
		/** The Events style: a row with nothing to mark, and the count of
		 * the highlighted row's events in the window. */
		events: {
			noLimit: "no limit",
			yesNever: "never Yes in {window}",
			yesOnce: "Yes once in {window}",
			yesMany: "Yes {count} times in {window}",
			pastNever: "never past {limit} in {window}",
			pastOnce: "once past {limit} in {window}",
			pastMany: "{count} times past {limit} in {window}",
			underNever: "never under {limit} in {window}",
			underOnce: "once under {limit} in {window}",
			underMany: "{count} times under {limit} in {window}"
		},
		/** A Group pane's notes and its readout's sub line. */
		group: {
			shown: "{shown} of {total} shown",
			otherUnits: "{count} in other units left out",
			historyFull: "history full: {kept} of {total}",
			notFound: "{count} not found",
			position: "{n} of {total}",
			highest: "max of {total}",
			lowest: "min of {total}",
			needsReading: "Pick a reading: the strip graphs its folder",
			readingMissing: "The folder's reading is not in HWiNFO's list now",
			needsFilter: "Type a filter in the dial settings",
			matchesNothing: "Matches nothing in HWiNFO's list right now",
			listEmpty: "Tick readings for this graph in the dial settings"
		},
		/** The Ambient style's words, bottom left of its first slot. */
		ambient: {
			mark: "{window}",
			stale: "stale",
			unavailable: "unavailable"
		},
		/** Strip Screens: a screen's place and its automatic names, shown in
		 * the window words for a moment after a screen change. */
		screen: {
			place: "{n} of {count}",
			more: "{name} +{count}",
			everyUnit: "Every {unit}"
		}
	}
} as const;

/**
 * The settings panels' English, written into ui/pi-strings.js (hwT and the
 * data-l10n attributes); not bundled into the plugin. This covers the fixed
 * labels of the 1.8 sections; docs/localization.md lists what still lives
 * only in the panel files.
 */
export const PANEL = {
	pi: {
		/** Words more than one 1.8 section uses. */
		common: {
			cancel: "Cancel",
			minutes5: "5 minutes",
			minutes15: "15 minutes",
			readings: "Readings",
			allKeysAnd: "All keys and dials"
		},
		/** Sensor Dial panel, Strip section. */
		strip: {
			strip: "Strip",
			layout: "Layout",
			independentDials: "Independent dials",
			wholeStrip: "Whole strip",
			equalSplit: "Equal split",
			waitingForThe: "Waiting for the plugin.",
			stripsNeedA: "Strips need a Stream Deck + or + XL. This deck has no touch strip.",
			dialsOnThisLabel: "Dials on this strip",
			everyDialLeaves: "Every dial leaves",
			restoreTheStrip: "Restore the strip",
			keepTheStrip: "Keep the strip's setup",
			useThisDial: "Use this dial's copy",
			useThisDeck: "Use this deck's dials",
			timeWindow: "Time window",
			minute1: "1 minute",
			bothHalves: "Both halves",
			sameWindow: "Same window",
			theStrip: "The strip",
			graph: "Graph",
			styleTrend: "Trend · up to 3",
			styleArea: "Area · up to 3",
			styleCompare: "Compare · up to 4",
			styleLanes: "Lanes · up to 3, own scales",
			styleHeat: "Heat · 1, colored bins",
			styleGroup: "Group · up to 32, one unit",
			styleAmbient: "Ambient · up to 48",
			styleMeters: "Meters · one per dial",
			styleEvents: "Events · up to 4",
			styleEventsLimits: "Events · Yes/No or readings with limits",
			styleCompareUnits: "Compare · readings in one unit",
			compareUnits: "Compare is for one unit; these draw in {count} bands, one per unit. Lanes gives each its own scale.",
			view: "View",
			viewAuto: "Auto",
			viewRows: "Rows",
			viewNow: "Now",
			viewSpread: "Spread",
			viewTiles: "Tiles",
			readingsFrom: "Readings from",
			fromFolder: "The folder of a ticked reading",
			fromFilter: "Readings matching a filter",
			fromList: "A custom list",
			fromUnit: "Every reading in a unit",
			unitPick: "Unit",
			filter: "Filter",
			useStyle: "Use {style}",
			notDrawnIn: "not drawn in {style}",
			notDrawnUnit: "not drawn: other unit",
			notMarkedNoBand: "nothing to mark: no alert band",
			readout: "Readout",
			briefGaps: "Brief gaps",
			gapConnect: "Connect",
			gapMark: "Connect in color",
			gapLeave: "Leave gaps",
			readoutOff: "Off",
			readoutLeft: "Large values on the left",
			readoutOnly: "Large values only",
			look: "Look",
			lookThin: "Thin bar",
			lookFull: "Full bar",
			lookLiquid: "Liquid",
			searchReadingsToPlaceholder: "Search readings to tick",
			tickedReadingsDrawIn: "Ticked readings draw in the order you tick them.",
			downArrowMovesInto: "Down Arrow moves into the search results, arrows move inside them, Tab leaves them.",
			readingsInThisLabel: "Readings in this graph",
			showOnThe: "Show on the graph",
			currentValue: "Current value",
			minAndMax: "Min and max",
			unit: "Unit",
			names: "Names",
			timeSpan: "Time span",
			scaleAndGrid: "Scale and grid",
			scaleFrom: "Scale from",
			autoPlaceholder: "Auto",
			scaleTo: "Scale to",
			scaleNotUsed: "This graph does not use these ends.",
			alertBands: "Alert bands",
			addABand: "Add a band",
			rightHalf: "Right half",
			scaleAndAlerts: "Scale and alerts",
			alertBandOne: "1 alert band",
			alertBandMany: "{count} alert bands",
			stripLinkId: "Strip Link ID",
			optionalNamePlaceholder: "Optional name",
			forHwinfoControlKeys: "For HWiNFO Control keys with a Strip command.",
			noPreviewYet: "No preview yet",
			previewOfTheNew: "Preview of the new strip",
			makeTheStrip: "Make the strip",
			madeTheStrip: "The strip is made. Every change here now applies at once.",
			rejoined: "Applied. Dial {n} is back in the strip.",
			joined: "Applied. Dial {n} is in the strip.",
			restoredAll: "Applied. Every dial that left is back in the strip.",
			changedElsewhere: "Another dial's panel changed this strip first. Try again.",
			refused: "The plugin refused this change ({detail}).",
			noAnswer: "No answer from the plugin. The panel shows the strip as it last heard it.",
			notANumber: "A scale end or band limit is not a number. Fix it or clear it.",
			howTheStrip: "How the strip works",
			everySlotNeeds: "Every slot needs a Sensor Dial; the app updates the slices one by one.",
			inAStrip: "In a strip",
			// Screens (a Whole strip): the list, its toolbar and Next screen.
			addAScreen: "Add a screen",
			nextScreen: "Next screen",
			byHand: "By hand",
			every10Seconds: "Every 10 seconds",
			every30Seconds: "Every 30 seconds",
			everyMinute: "Every minute",
			every5Minutes: "Every 5 minutes",
			screenToolsLabel: "Screen on the strip",
			thisScreen: "This screen",
			thisScreenNamed: "This screen: {name}",
			screenPlace: "{n} of {count}",
			screenBefore: "Show the screen before",
			screenAfter: "Show the screen after",
			editScreens: "Edit",
			doneScreens: "Done",
			earlier: "Earlier",
			later: "Later",
			rename: "Rename",
			remove: "Remove",
			add: "Add",
			screenKeys: "Left and Right show the screen before or after on the strip, Home and End the first or the last. Alt with an arrow moves the screen on the strip, Alt+Home and Alt+End to either end; F2 renames it; Delete twice removes it.",
			screenLegend: "Screen {n} of {count}: {name}",
			screenNumber: "Screen {n}",
			screenEveryUnit: "Every {unit}",
			screenNameLabel: "Name of screen {n}; empty shows {auto}",
			screenOnStrip: "{name} on the strip, {n} of {count}",
			moveScreenEarlier: "Move {name} earlier",
			moveScreenLater: "Move {name} later",
			renameScreen: "Rename {name}",
			removeScreen: "Remove {name}",
			addScreenAfter: "Add a screen after {name}",
			screensFull: "A strip keeps at most {max} screens",
			toolKey: "{label} ({key} in the list)",
			screenMoved: "{name} is now {n} of {count}",
			screenAdded: "Screen {n} of {count} added. Type its filter.",
			removeArmed: "Press again to remove",
			removeArmedLabel: "Press again to remove {name}",
			removeArmedKey: "Press Delete again to remove {name}",
			screenRemoved: "Removed {name}. {next} is on the strip.",
			screenRenamed: "Renamed to {name}",
			screenNameCleared: "Screen {n} shows its automatic name again",
			captionHeld: "On the deck now · held while this panel is open",
			captionLive: "On the deck now",
			captionPaused: "On the deck now · paused on the deck",
			// The Filter field's count slot (status words, not help).
			filterTry: "Try",
			filterNothing: "{filter} matches nothing right now.",
			filterDeadOne: "{glob} matches nothing.",
			filterDeadMany: "{globs} match nothing.",
			// The dial map: a mark per dial slot and its status line.
			leftHalf: "Left half",
			dialPlace: "dial {n} of {count}",
			dialMissing: "Dial {n} is missing",
			dialLeft: "Dial {n} left the strip",
			dialNotIn: "Dial {n} is not in the strip",
			dialElsewhere: "Dial {n} is in another strip",
			dialOutside: "Dial {n} is outside the strip",
			dialIn: "Dial {n} is in the strip",
			dialStayed: "Dial {n} is still in the strip this dial left",
			thisStrip: "This strip",
			dialsMissing: "Dials {dials} are missing",
			dialRun: "{from} to {to}",
			dragDials: "Drag a Sensor Dial to each in the Stream Deck app.",
			dialOtherCopy: "Dial {n} holds a different copy",
			markDial: "Dial {n}, {state}",
			markSelf: "this dial",
			markIn: "in this strip",
			markStayed: "still in the strip this dial left",
			markMissing: "missing, add a Sensor Dial",
			markLeft: "left the strip",
			markElsewhere: "in another strip",
			markOutside: "outside this strip's dials",
			markNotIn: "not in a strip",
			markCopy: "holds a different copy of this strip",
			actionRejoin: "Rejoin",
			actionMove: "Move here",
			actionInclude: "Include",
			// Build screens: the link, its list and its one button.
			buildLink: "Build screens",
			buildScreens: "Build screens for this PC",
			buildCpuGpu: "CPU and GPU",
			buildCpu: "CPU",
			buildCores: "CPU cores",
			buildGpu: "GPU",
			buildCooling: "Cooling",
			buildClocks: "Core clocks",
			buildTemps: "Every temperature",
			buildAreaReadout: "Area with large values",
			buildGroupRows: "Group Rows",
			buildGroupTiles: "Group Tiles",
			buildGroupNow: "Group Now",
			buildMatching: "{count} readings matching {filter}",
			buildInUnit: "{count} readings in {unit}",
			buildTitleNoTick: "Build screens for this PC: no screen ticked.",
			buildTitleAfter: "Build screens for this PC: adds {count} after screen {last}.",
			buildTitleNone: "Build screens for this PC: nothing on this PC fits a screen.",
			buildTitleSame: "Build screens for this PC: the strip already has every screen it finds.",
			buildAlready: "Already on the strip: {names}.",
			buildTitleFull: "Build screens for this PC: this strip already keeps {max} screens.",
			buildNoRoom: "{names}: no room, a strip keeps at most {max} screens.",
			useTheseScreens: "Use these screens",
			oneReadingOnly: "One reading only",
			screensBuilt: "Added {names}.",
			// The words that name a strip's start, a quiet dropdown where there
			// is a choice: Build's screens or one reading for a Whole strip,
			// the pairs this PC's sensors fill or each half for an Equal split.
			startFrom: "Start from",
			startScreens: "Screens for this PC",
			startWholeMany: "a Whole strip of {count} screens",
			startWholeOne: "a Whole strip of one screen",
			startNoTick: "no screen ticked",
			startCpuRam: "CPU and RAM usage",
			pairCpuUsage: "CPU usage",
			pairRamUsage: "RAM usage",
			startTempLoad: "Temperature and load",
			startCpuCooling: "CPU and cooling",
			startOwn: "Choose each half",
			// Fill both halves: a running Equal split takes a pair.
			fillBothHalves: "Fill both halves",
			fillOne: "Fill: {name}",
			fillUse: "Use",
			fillUseLabel: "Use {name} on both halves",
			// Use over a half a person made asks first, naming it.
			fillAskLeft: "Replace the left half, '{name}'?",
			fillAskLeftPlain: "Replace the left half?",
			fillAskRight: "Replace the right half, '{name}'?",
			fillAskRightPlain: "Replace the right half?",
			fillAskBoth: "Replace both halves, '{left}' and '{right}'?",
			fillAskBothPlain: "Replace both halves?",
			fillAlsoWhole: "This also changes the Whole strip's first screen.",
			fillReplace: "Replace",
			previewOnly: "Preview only"
		},
		/** Alerts, Timing (both sensor panels). */
		timing: {
			timing: "Timing",
			alertAfter: "Alert after",
			immediately: "Immediately",
			seconds2: "2 seconds",
			seconds5: "5 seconds",
			seconds10: "10 seconds",
			seconds30: "30 seconds",
			snoozeLasts: "Snooze lasts",
			hour1: "1 hour",
			clearBy: "Clear by",
			zeroAtLimitPlaceholder: "0 (at the limit)",
			itsClearBy: "Its clear by",
			snoozeWithA: "Snooze with a Custom gesture or an HWiNFO Control key.",
			offAPress: "Off (a press keeps its action)",
			aHoldStillDoes: "A hold still does what Press sets for it."
		},
		/** Advanced, Reading links. */
		links: {
			readingLinks: "Reading links",
			keepsAReadingShowing: "Keeps a reading showing when Auto switches source.",
			readingToLink: "Reading to link",
			filterTheOther: "Filter the other source's readings",
			matchingReading: "Matching reading",
			link: "Link",
			storedLinksLabel: "Stored links"
		},
		/** Advanced, Calculated readings. */
		calc: {
			calculatedReadings: "Calculated readings",
			listedUnderCalculated: "Listed under Calculated (plugin) in every reading picker.",
			calculatedReadingsLabel: "Calculated readings",
			newCalculatedReading: "New calculated reading",
			operation: "Operation",
			sum: "Sum",
			average: "Average",
			lowest: "Lowest",
			highest: "Highest",
			differenceAB: "Difference (A - B)",
			ratioAB: "Ratio (A / B)",
			addAReading: "Add a reading",
			showAAs: "Show A as a percentage of B",
			labelOptional: "Label (optional)",
			save: "Save"
		},
		/** Key and dial panels, Display: Unit and decimals per reading (issue #59). */
		formats: {
			unitAndDecimals: "Unit and decimals per reading",
			/** What the setting does: the unit stays put (issue #59 G5). The two
			 * unit families are named by the Unit list's groups. */
			staysAtAnyValue: "A unit picked here stays at any value.",
			unitAndDecimalsFor: "Unit and decimals for each reading",
			/** A row's note, only while the face draws that reading in a
			 * shorter text than its own (no decimals, or compact): what it
			 * shows there, then the unit or decimals that would fit. The
			 * row's own name line above it names the reading. */
			showsOnKey: "Shows {text} on this key.",
			showsOnDial: "Shows {text} on this dial.",
			unitFits: "{unit} fits.",
			unitFitsOneDecimal: "{unit} fits with 1 decimal.",
			unitFitsDecimals: "{unit} fits with {count} decimals.",
			unitFitsNoDecimals: "{unit} fits with no decimals.",
			oneDecimalFits: "1 decimal fits.",
			noDecimalsFit: "Fits with no decimals.",
			decimalsFit: "{count} decimals fit."
		},
		/** Key panel, Display: Background and Words in the accent color (the
		 * look names and On/Off also name the shared defaults). */
		keyBackground: {
			background: "Background",
			theme: "Theme",
			glass: "Glass",
			tint: "Tint",
			outline: "Outline",
			clear: "Clear",
			stars: "Stars",
			nebula: "Nebula",
			dusk: "Dusk",
			showsThePagePicture: "Shows the page picture; an alert still fills the key.",
			/** The dial's and the strip's line under Background on the
			 * see-through looks. */
			showsTheStripPicture: "Shows the touch strip picture set in the Stream Deck app.",
			/** Under Background on an art look, only where it adds a fact: the
			 * face draws a light theme (Paper), where the art draws no sky
			 * (deck-art.ts artFits). It changes with the theme only, never
			 * with a pick in the Sky's pair. */
			artPaper: "Paper draws no sky; a dark theme shows it.",
			/** The art looks' Sky: Stars and its three amounts, Sky color and
			 * its five tones (stored warm and cool show as Warmer and Cooler). */
			starsLabel: "Stars",
			starsAll: "All",
			starsFew: "Few",
			starsOff: "Off",
			skyColor: "Sky color",
			skyTheme: "Theme",
			skyDeep: "Deep",
			skyWarm: "Warmer",
			skyCool: "Cooler",
			skyMono: "Mono",
			wordsInTheAccent: "Words in the accent color",
			on: "On",
			off: "Off"
		},
		/** Advanced, Shared defaults: one Background and one Words for every
		 * key, dial and strip set to Default, the count line under them and
		 * its link (src/ui/shared-looks.ts), and the strip's Default. */
		sharedLooks: {
			/** An action's Default option: the value it follows, then where
			 * it comes from (Text color, Background, Words, Stars, Sky color). */
			followsShared: "{value} (shared)",
			wordsLabel: "Words in the accent color",
			keyOne: "1 key",
			keyMany: "{count} keys",
			dialOne: "1 dial",
			dialMany: "{count} dials",
			stripOne: "1 strip",
			stripMany: "{count} strips",
			listTwo: "{a} and {b}",
			listThree: "{a}, {b} and {c}",
			ownBackgroundOne: "{who} uses its own background.",
			ownBackgroundMany: "{who} use their own background.",
			ownWordsOne: "{who} uses its own word color.",
			ownWordsMany: "{who} use their own word color.",
			ownMixed: "{who} use their own background or word color.",
			useItEverywhere: "Use it everywhere",
			useArmed: "Press again to use it everywhere"
		}
	}
} as const;

/** Every dotted path to a string leaf of T. */
export type LeafKeys<T, P extends string = ""> = {
	[K in keyof T & string]: T[K] extends string ? `${P}${K}` : LeafKeys<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A key of the runtime catalog (t()). */
export type CatalogKey = LeafKeys<typeof EN>;

/** A key of the panel catalog (hwT()). */
export type PanelKey = LeafKeys<typeof PANEL>;
