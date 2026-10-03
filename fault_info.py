"""Fault knowledge base: colours, descriptions, data signatures, causes, actions.

`signature` lines are measurements taken from the supplied dataset (combined_dataset.csv), not textbook
generalities - so the Index tab matches what the AI actually sees.
"""

FAULT_INFO = [
    dict(
        id="healthy", name="Healthy", color="#22c55e", icon="✔", urgency="None",
        short="Normal operation - smooth, balanced drive with no abnormal energy loss.",
        what="The motor, belt and bearings are in specification. Vibration is low and dominated by the shaft's own rotation "
             "frequency (1×). Belt speed tracks motor speed and power draw matches the healthy reference for the load.",
        signature=["Vibration RMS ≈ 0.024 g, peak at 1× shaft frequency (~24 Hz)", "Current ≈ 8.4 A, power factor ≈ 0.84",
                   "Temperature ≈ 30 °C and stable", "Belt/motor speed ratio at nominal"],
        causes=["-"], actions=["Continue routine condition monitoring.", "Keep lubrication and belt-tension schedule."],
        animation="Smooth, steady rotation · belt tracks centred · calm green status glow",
    ),
    dict(
        id="belt_misalignment", name="Belt Misalignment", color="#f59e0b", icon="⇌", urgency="Schedule",
        short="Pulleys are not in the same plane - the belt tracks sideways and rubs the flanges.",
        what="Angular or parallel misalignment between the motor and driven pulley makes the belt wander laterally. It adds "
             "cyclic side-load on the bearings, wears the belt edges and costs extra power through friction.",
        signature=["Vibration RMS ≈ 0.06 g (≈ 2.5× healthy) with strong 2× and 4× shaft harmonics", "Current ≈ 9.2 A (+10 %)",
                   "Temperature creeps up ≈ 32 → 35 °C", "Power ≈ +8 % vs. healthy reference"],
        causes=["Pulley shafts not parallel or not coplanar", "Loose or shifted motor mounting", "Uneven belt tension or worn pulley groove"],
        actions=["Laser- or straight-edge-align the pulleys.", "Re-tension the belt to spec and check the mounting bolts.",
                 "Inspect belt edges for fraying."],
        animation="Belt weaves side-to-side · driven pulley yawed · amber edge-wear sparks",
    ),
    dict(
        id="excessive_load", name="Excessive Load", color="#ef4444", icon="⚠", urgency="Urgent",
        short="The motor is driven beyond 100 % load - high current, falling speed and rising heat.",
        what="The conveyor demands more torque than the motor is rated to deliver. Current and winding temperature climb, speed "
             "sags, and insulation life is cut sharply for every few degrees of overheating.",
        signature=["Load ≈ 105 % and current ≈ 12.5 A (+49 %)", "Motor speed sags ≈ 1430 rpm (−3 %)", "Temperature climbing 32 → 41 °C",
                   "Power factor rises to ≈ 0.88; input power ≈ 7.5 kW"],
        causes=["Material overload or jammed conveyor", "Dragging rollers / seized idler", "Undersized motor for the duty"],
        actions=["Reduce the material feed immediately.", "Check for jams, seized idlers or belt drag.",
                 "Verify motor sizing and protection settings."],
        animation="Overheating glow + heat shimmer · motor slows and strains · crates pile up on the belt",
    ),
    dict(
        id="mechanical_imbalance", name="Mechanical Imbalance", color="#a855f7", icon="◐", urgency="Schedule",
        short="Uneven mass on the rotor or pulley - the machine shakes once per revolution.",
        what="An eccentric mass (lost balance weight, material build-up, a bent shaft) throws a rotating force that shakes the whole "
             "machine at exactly the shaft frequency, loading bearings and the foundation.",
        signature=["Highest vibration RMS ≈ 0.08 g (≈ 3.3× healthy)", "Dominant peak at 1× shaft frequency (~24 Hz)",
                   "Current ≈ 8.7 A, temperature rises slowly 30 → 34 °C", "Power ≈ +2 % vs. healthy reference"],
        causes=["Lost or shifted balance weight", "Material build-up on the pulley or rotor", "Bent shaft or loose pulley"],
        actions=["Clean the pulley/rotor and check for missing weights.", "Dynamically balance the rotor assembly.",
                 "Check pulley hub and shaft run-out."],
        animation="Eccentric mass orbits · whole machine shakes at 1× · shaft whirls",
    ),
    dict(
        id="belt_slip", name="Belt Slip", color="#06b6d4", icon="≋", urgency="Urgent",
        short="The belt slides on the pulley - motor spins but the conveyor falls behind.",
        what="Insufficient tension or a glazed pulley lets the belt slip. The motor keeps its speed but delivers about 20 % less "
             "belt travel, so every metre of material costs more energy even though kW looks normal or low.",
        signature=["Belt-speed / motor-speed ratio ≈ −20 % vs. healthy", "Sub-synchronous vibration (~8 Hz) from stick-slip",
                   "Load ≈ 49 %, current ≈ 7.3 A", "Energy per metre of belt travel ≈ +25 % - invisible in plain kW"],
        causes=["Belt tension too low or belt stretched", "Glazed / contaminated pulley surface", "Short-term torque spikes"],
        actions=["Re-tension the belt and clean the pulley.", "Replace a glazed or stretched belt.",
                 "Check for oil/water contamination."],
        animation="Pulley outpaces the belt · friction sparks and smoke · tread marks lag behind",
    ),
    dict(
        id="bearing_degradation", name="Bearing Degradation", color="#ec4899", icon="◎", urgency="Urgent",
        short="A bearing is wearing out - rising broadband vibration, heat and noise.",
        what="Pitting, spalling or lubricant failure in a rolling bearing produces impacts that show as non-synchronous, high-frequency "
             "vibration. It progresses: vibration and temperature climb until the bearing seizes or the shaft is damaged.",
        signature=["Vibration RMS grows 0.04 → 0.08 g as it progresses", "Non-synchronous peaks at ~130-175 Hz (defect frequencies)",
                   "Temperature climbs 29 → 38 °C", "Current ≈ 9.0 A, power ≈ +4 % vs. healthy reference"],
        causes=["Lubricant loss or contamination", "Normal wear / fatigue at end of life", "Shaft misalignment or overload history"],
        actions=["Plan bearing replacement before seizure.", "Re-lubricate if applicable and inspect for contamination.",
                 "Trend vibration weekly; replace if RMS keeps rising."],
        animation="Bearing housing glows hot · rapid rattle jitter · metal debris falls",
    ),
]

BY_NAME = {f["name"]: f for f in FAULT_INFO}
