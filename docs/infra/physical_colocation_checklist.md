# Physical Colocation & Datacenter Facility Audit Checklist (Tier-3 Standard)

## 1. Facility & Power Infrastructure

- [ ] **Dual Utility Power Feeds:** Datacenter has two independent, geographically diverse power feeds originating from separate utility sub-stations.
- [ ] **Uninterruptible Power Supply (UPS) Redundancy:** True $2N$ or $N+1$ online double-conversion UPS topology with separate battery banks.
  - Runtime under full load: Minimum 20 minutes before generator synchronization.
  - Health checks: Automatic battery impedance testing and monthly discharge test logs available.
- [ ] **Backup Diesel Generators:**
  - Configuration: $N+1$ standby diesel generator sets.
  - Fuel Storage: Minimum 48 hours continuous runtime at full site load stored on-site.
  - Fuel Supply Contract: SLA with local fuel vendors guarantees emergency refueling within 4 hours.
  - Transfer Time: Automatic Transfer Switch (ATS) transitions from utility failure to generator load within 10–12 seconds.
- [ ] **Dual Power to Rack (A + B Feeds):**
  - Every server and network switch is equipped with dual redundant power supply units (PSU-A and PSU-B).
  - PDU-A connects exclusively to UPS-A; PDU-B connects exclusively to UPS-B.
  - Rack PDU monitoring: Per-outlet or per-branch current monitoring via SNMP/Modbus.

---

## 2. Environmental Controls & Cooling

- [ ] **Precision Air Conditioning (CRAC / CRAH):** $N+1$ computer room air conditioning units maintaining temperature and humidity.
  - Target Temperature: $20^\circ\text{C}\text{ to }24^\circ\text{C}$ ($68^\circ\text{F}\text{ to }75^\circ\text{F}$) at cold aisle rack inlets (ASHRAE TC 9.9 compliant).
  - Relative Humidity: $40\%\text{ to }60\%$ non-condensing.
- [ ] **Aisle Containment:** Physical hot aisle or cold aisle containment panels installed to prevent air mixing and hotspots.
- [ ] **Water Leak Detection:** Rope sensors placed beneath raised floor tiles along cooling pipes and air handlers with automated alarm annunciator.

---

## 3. Fire Detection & Suppression

- [ ] **Early Warning Smoke Detection:** Very Early Smoke Detection Apparatus (VESDA) air-sampling system with multi-stage sensitivity.
- [ ] **Clean Agent Suppression System:** Total flooding clean agent system (FM-200, Novec 1230, or Inergen) certified safe for electrical equipment and human presence.
- [ ] **Pre-Action Sprinkler System:** Double-interlock dry-pipe pre-action water system as secondary defense (never wet-pipe directly over live racks).
- [ ] **Gas Damper Integration:** Automated HVAC dampers shut off immediately upon gas release to contain suppression agent.

---

## 4. Physical Security & Access Control

- [ ] **Perimeter Defense:** Controlled facility perimeter with 24/7 on-site security guards, vehicle barriers, and anti-tailgating turnstiles.
- [ ] **Multi-Factor Biometric Access:** Access to data halls and dedicated suites requires badge + biometric scan (fingerprint or iris).
- [ ] **CCTV Coverage:** Continuous 4K CCTV surveillance covering all external perimeters, corridors, and rack aisles with minimum 90-day video retention.
- [ ] **Rack Enclosure Locks:** Server racks equipped with individual electronic combination or smart-card locks.
- [ ] **Escort Policy:** All vendor and third-party technicians must be accompanied by authorized engineering staff at all times.

---

## 5. Network Connectivity & Telecommunications

- [ ] **Carrier Diversity:** Minimum 3 independent Tier-1/Tier-2 telecommunications carriers entering the building through separate underground conduits.
- [ ] **Diverse Meet-Me Rooms (MMR):** Two separated MMRs (MMR-A and MMR-B) preventing single point of failure in fiber cross-connects.
- [ ] **Structured Cabling:** Pre-terminated OM4 multimode fiber or OS2 single-mode fiber with color-coded Cat6A STP patch cables; overhead cable trays separate power and data.
