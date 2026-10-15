"use client";

import { useMemo, useRef, useState } from "react";
import "./ujjivan-audit.css";

type Finding = {
  id: string;
  priority: "P1" | "P2";
  category: string;
  title: string;
  issue: string;
  evidence: string;
  fix: string;
  cropTitle: string;
  cropLines: string[];
};

type AuditPage = {
  id: string;
  tab: string;
  title: string;
  url: string;
  findings: Finding[];
};

type EditValues = { title?: string; issue?: string; fix?: string };

const AUDITS: AuditPage[] = [
  {
    id: "home",
    tab: "Homepage",
    title: "Homepage",
    url: "https://www.ujjivansfb.bank.in/",
    findings: [
      { id: "home-1", priority: "P1", category: "Navigation", title: "Navigation mixes products, tasks and support tools", issue: "The primary navigation places product categories, digital-banking areas, calculators, interest rates and branch-locator tools at similar levels. Customers have to understand the bank's internal structure before they can choose a route.", evidence: "Products & Services · Banking Suites · Smart Banking · Apply Now · Calculators · Locate Us", fix: "Reorganize the primary navigation around customer tasks: Open an account, Save and invest, Borrow, Bank digitally and Get help. Keep regulatory and investor resources in utility navigation.", cropTitle: "Main navigation", cropLines: ["Products & Services  |  Banking Suites", "Smart Banking  |  Apply Now  |  Calculators", "Interest & Rates  |  Locate Us"] },
      { id: "home-2", priority: "P1", category: "Information hierarchy", title: "The maximum savings rate is not tied to its qualifying balance", issue: "The homepage promotes a savings rate of up to 7.15% p.a., while the rate table places that slab above ₹25 crore. Customers with ordinary balances can interpret the maximum rate as broadly available.", evidence: "Up to 7.15% p.a. — highest balance slab applies above ₹25 crore.", fix: "Place a plain-language qualification directly beside the promotional rate and link to the full balance-slab table. Lead with the applicable rate for common retail balances.", cropTitle: "Savings rate promotion", cropLines: ["Savings Account Interest Rate", "Up to 7.15% p.a.", "Highest slab: balances above ₹25 crore"] },
      { id: "home-3", priority: "P1", category: "Language & tone", title: "FD promotional rates hide material qualifying conditions", issue: "The homepage promotes standard, senior-citizen and Platina FD rates together even though they apply to different customer types, deposit sizes and withdrawal conditions.", evidence: "7.80% p.a. · 8.30% p.a. for senior citizens · Platina FD has a high-value/non-callable condition.", fix: "Show the customer type, minimum deposit, applicable tenure and premature-withdrawal restriction beside each rate card, not several clicks later.", cropTitle: "Fixed deposit rates", cropLines: ["Fixed Deposit up to 7.80% p.a.", "Senior citizens: up to 8.30% p.a.", "Platina FD: higher-value, non-callable deposit"] },
      { id: "home-4", priority: "P2", category: "Usability & interaction", title: "“Apply Now” is too generic for very different journeys", issue: "A single broad application entry point groups products with different requirements and flows. It does not tell customers whether they are opening an account, booking a deposit or applying for credit.", evidence: "Apply Now", fix: "Use contextual CTAs such as “Open Savings Account”, “Book Fixed Deposit” and “Check Home Loan Eligibility”. Use “Apply” for the final action within the relevant product flow.", cropTitle: "Primary call to action", cropLines: ["Apply Now", "Choose a product before the journey is clear", "Multiple products lead to different application flows"] },
      { id: "home-5", priority: "P1", category: "Language & tone", title: "Legacy domain pages expose stale promotional rates", issue: "Older official-domain rate pages remain discoverable alongside the current domain. The conflicting dates and headline rates can undermine trust and cause customers to compare outdated information.", evidence: "Older rate page: effective 5 Aug 2025 · current rate page: effective 1 Sep 2026.", fix: "Audit legacy URLs, redirect superseded pages, update canonical tags and remove stale rate pages from search indexing. Keep every promoted rate connected to the approved current source.", cropTitle: "Search result / rates page", cropLines: ["Fixed Deposit Interest Rates", "Effective 5 August 2025", "Older page appears beside current rates"] }
    ]
  },
  {
    id: "savings",
    tab: "Savings Accounts",
    title: "Savings account hub",
    url: "https://www.ujjivansfb.bank.in/personal/savings-account",
    findings: [
      { id: "savings-1", priority: "P1", category: "Information hierarchy", title: "The highest rate dominates the rate table", issue: "The maximum savings rate is easier to notice than the balance slab needed to qualify for it. Most retail users need a quick answer for their likely balance, not just the top advertised rate.", evidence: "Up to 7.15% p.a.; the highest slab applies above ₹25 crore.", fix: "Show balance slabs under the hero and explain how rates apply to each slab. Add a quick example for common retail balances.", cropTitle: "Savings account interest rates", cropLines: ["Up to 7.15% p.a.", "Higher rate applies to higher balance slabs", "Above ₹25 crore: top slab"] },
      { id: "savings-2", priority: "P2", category: "Information hierarchy", title: "Seven account variants are hard to compare side by side", issue: "Regular, Digital, Classic, Privilege, Maxima, Minor and Senior Citizen accounts have different eligibility and benefits, but users must jump between individual product descriptions to compare them.", evidence: "Multiple standalone account cards with separate detail pages.", fix: "Add a comparison table for minimum balance, eligibility, debit-card benefits, charges, key benefits and intended customer. Include a “Help me choose” route.", cropTitle: "Savings account variants", cropLines: ["Regular  |  Digital  |  Classic", "Privilege  |  Maxima  |  Minor", "Senior Citizen Savings Account"] },
      { id: "savings-3", priority: "P1", category: "Usability & interaction", title: "Important account qualification is buried in product details", issue: "The Privilege Savings Account describes a ₹25,000 monthly average balance or a qualifying recurring-deposit arrangement, which is a material requirement for deciding whether the product fits.", evidence: "Privilege Savings Account: ₹25,000 monthly average balance or eligible recurring-deposit arrangement.", fix: "Put the qualification directly under the account name in the listing and repeat it beside the application CTA. Explain what happens if the requirement is not maintained.", cropTitle: "Privilege Savings Account", cropLines: ["Privilege Savings Account", "₹25,000 monthly average balance", "Or qualifying recurring-deposit arrangement"] },
      { id: "savings-4", priority: "P2", category: "User engagement", title: "Cross-promotion competes with the account being evaluated", issue: "Generic Digital Savings Account promotion appears on other account pages, including variants with very different audiences. It distracts from the account's own eligibility and benefits.", evidence: "“Supercharge your wealth journey” Digital Savings Account promotion on account detail pages.", fix: "Use context-aware related content. Prioritize guardian requirements on the Minor account and benefits/eligibility on the Privilege account before showing secondary products.", cropTitle: "Related product promotion", cropLines: ["Supercharge your wealth journey", "Digital Savings Account", "Promotion interrupts current account comparison"] },
      { id: "savings-5", priority: "P2", category: "Usability & interaction", title: "Card actions do not consistently communicate the next step", issue: "Labels such as “Explore”, “Apply” and “Open Online” can imply similar actions even though some open information pages and others start an application.", evidence: "Explore · Apply · Open Online", fix: "Standardize the two core actions as “View account details” and “Open account”. Show the application CTA only where that product supports digital opening.", cropTitle: "Account card actions", cropLines: ["Explore  |  Apply  |  Open Online", "Action labels imply different levels of commitment", "Users cannot predict the next screen"] }
    ]
  },
  {
    id: "fd",
    tab: "Fixed Deposits",
    title: "Deposits and fixed deposits",
    url: "https://www.ujjivansfb.bank.in/personal/deposits/latest-fixed-deposit-interest-rates",
    findings: [
      { id: "fd-1", priority: "P1", category: "Information hierarchy", title: "The maximum FD rate appears before its qualifying conditions", issue: "The page promotes a maximum headline rate alongside senior-citizen and Platina rates. The offers have different customer, deposit-size, tenure and withdrawal conditions.", evidence: "Standard up to 7.80% · senior citizens up to 8.30% · Platina requires a deposit above ₹1 crore and is non-callable.", fix: "Place customer type, minimum deposit, tenure and withdrawal restrictions directly beside each rate. Separate standard and special-category offers.", cropTitle: "Fixed Deposit rates", cropLines: ["Up to 7.80% p.a.", "Senior citizens: up to 8.30% p.a.", "Platina: above ₹1 crore; non-callable"] },
      { id: "fd-2", priority: "P1", category: "Navigation", title: "Resident, NRE, NRO and special deposits are difficult to filter", issue: "Multiple rate tables and eligibility rules are presented on a dense page. NRE and NRO deposits have distinct tenure and premature-closure rules that customers must locate manually.", evidence: "Domestic · NRE · NRO · Platina · Tax Saver FD rate tables.", fix: "Add a customer-type selector and filter the rates and terms for Resident, Senior Citizen, NRE, NRO or High-value depositor. Keep the complete rate table available below.", cropTitle: "Rate table categories", cropLines: ["Domestic Fixed Deposits", "NRE  |  NRO  |  Platina  |  Tax Saver", "Different rules apply to each deposit type"] },
      { id: "fd-3", priority: "P1", category: "Usability & interaction", title: "The FD calculator makes tenure entry unnecessarily complex", issue: "The calculator separates years, months and days and includes a “Days Only” input. Payout choices also change for tenures of 180 days or less, creating extra interpretation and validation work.", evidence: "Separate year/month/day controls; payout-selection condition for short tenures.", fix: "Use one tenure control with a Days/Months/Years selector. Adapt payout choices automatically and explain any disabled option inline.", cropTitle: "FD returns calculator", cropLines: ["Investment tenure", "Years  |  Months  |  Days", "Choose payout option (rules vary by tenure)"] },
      { id: "fd-4", priority: "P1", category: "Language & tone", title: "Tax Saver FD's eligibility and lock-in need to appear together", issue: "The page emphasizes the potential Section 80C deduction, but the five-year lock-in and old-tax-regime limitation are material to the customer's decision.", evidence: "Tax deduction up to ₹1.5 lakh under Section 80C; five-year lock-in; eligibility depends on tax regime.", fix: "Summarize eligible customer, applicable tax regime, five-year lock-in and maximum deduction together before the CTA. Keep tax guidance qualified and current.", cropTitle: "Tax Saver FD", cropLines: ["Save tax under Section 80C", "Deduction up to ₹1.5 lakh", "5-year lock-in · old tax regime eligibility"] },
      { id: "fd-5", priority: "P2", category: "Usability & interaction", title: "Users must mentally combine rate, tenure and payout to estimate returns", issue: "The rate table and FD calculator are separated, so a customer has to match the chosen tenure, applicable rate and payout method before they can understand likely maturity value.", evidence: "Rate by tenure in one section; calculator payout options in another.", fix: "Allow users to select amount and goal, then compare suitable tenures and payout options with interest earned and maturity value in the same view.", cropTitle: "Rate table and calculator", cropLines: ["Choose a tenure to find the rate", "Choose payout mode in calculator", "Maturity outcome is not shown in the rate table"] }
    ]
  },
  {
    id: "home-loan",
    tab: "Home Loans",
    title: "Home Loans",
    url: "https://www.ujjivansfb.bank.in/personal/loans/home-loans",
    findings: [
      { id: "home-loan-1", priority: "P1", category: "Usability & interaction", title: "Calculator tenure conflicts with the FAQ minimum", issue: "The EMI calculator permits 1 month to 240 months, while the FAQ states a 39-month minimum. Customers can calculate an outcome for a tenure that may not be available.", evidence: "Calculator: 1–240 months · FAQ: minimum tenure 39 months.", fix: "Align calculator validation and helper text with approved product rules. Add a test that keeps calculator ranges and FAQs in sync.", cropTitle: "Home Loan EMI calculator", cropLines: ["Loan tenure: 1–240 months", "FAQ: minimum tenure is 39 months", "Two conflicting constraints on one product page"] },
      { id: "home-loan-2", priority: "P1", category: "Language & tone", title: "Processing-fee claims contradict one another", issue: "The Pre-qualified Top Up Loan card states “Zero processing fee”, while the FAQ describes a non-refundable processing fee of ₹3,350 plus GST for all loan types.", evidence: "Product card: “Zero processing fee” · FAQ: ₹3,350 + GST non-refundable processing fee.", fix: "Confirm the fee waiver's scope with product/compliance and name any exceptions in the FAQ. Use one approved source for product cards, FAQs and charge tables.", cropTitle: "Fees and charges", cropLines: ["Pre-qualified Top Up Loan", "Zero processing fee", "FAQ: ₹3,350 + GST non-refundable fee"] },
      { id: "home-loan-3", priority: "P1", category: "Information hierarchy", title: "The eligibility section sends users to customer care instead of explaining eligibility", issue: "The section titled “Home Loan Eligibility Criteria” directs customers to phone or email support rather than listing the criteria. The document checklist is separated elsewhere on the page.", evidence: "Eligibility heading followed by customer-care phone/email instruction.", fix: "Show the actual approved eligibility parameters—applicant profile, income assessment, age and property requirements—then offer customer care as a secondary route.", cropTitle: "Home Loan Eligibility Criteria", cropLines: ["Home Loan Eligibility Criteria", "For eligibility, contact customer care", "No criteria visible under the heading"] },
      { id: "home-loan-4", priority: "P1", category: "Usability & interaction", title: "The calculator asks customers to guess the interest rate", issue: "Users must enter an interest rate manually even though loan rates are listed separately below the calculator. That makes it harder to generate a relevant estimate.", evidence: "Calculator accepts 5%–30% p.a.; product rates are shown further down the page.", fix: "Prefill an indicative rate for the selected loan product and disclose the assumption. Let users adjust it and state that the final approved rate may differ.", cropTitle: "EMI calculator inputs", cropLines: ["Interest rate: [ 5% – 30% ]", "Select rate before calculating EMI", "Indicative product rates listed below"] },
      { id: "home-loan-5", priority: "P1", category: "Information hierarchy", title: "The total borrowing cost is scattered across FAQs and charge tables", issue: "Processing, CLADUM, CERSAI and other charges are split across separate page sections and links. Customers cannot easily compare the EMI with the full cost of the loan.", evidence: "Fees, CLADUM charges and CERSAI information appear in different page sections.", fix: "Create a “What this loan may cost” summary with indicative EMI, total interest, processing fee and material additional charges, linking to the complete schedule.", cropTitle: "Loan costs", cropLines: ["EMI calculator result", "Processing fee · CLADUM · CERSAI", "Total cost requires reading separate sections"] }
    ]
  },
  {
    id: "two-wheeler",
    tab: "Two-Wheeler",
    title: "Two-wheeler loan",
    url: "https://www.ujjivansfb.bank.in/personal/loans/vehicle-loans/two-wheeler-loan",
    findings: [
      { id: "two-1", priority: "P1", category: "Language & tone", title: "Applicant age rules conflict between eligibility and FAQ", issue: "The eligibility section gives an age range of 18–59, while the FAQ says minimum age 21 and maximum age 62 at the end of the loan tenure. These rules answer different questions but are not reconciled.", evidence: "Eligibility: 18–59 years · FAQ: 21 minimum at application; 62 maximum at loan end.", fix: "Publish one approved rule and distinguish age at application from age at final EMI. Reuse the same rule in the page, calculator and application.", cropTitle: "Eligibility criteria", cropLines: ["Applicant age: 18–59 years", "FAQ: min 21; maximum age 62 at loan end", "Eligibility rules disagree"] },
      { id: "two-2", priority: "P1", category: "Language & tone", title: "The schedule of charges contradicts the FAQ", issue: "The fee table and FAQ report different documentation and late-payment charges. Customers cannot tell which amount or calculation basis applies.", evidence: "Document charge up to ₹2,000 + GST vs FAQ ₹1,000 + GST; late-payment terms also differ.", fix: "Have product/compliance validate every charge. Publish one effective-dated schedule and generate FAQ charge references from it.", cropTitle: "Schedule of charges", cropLines: ["Document charges: up to ₹2,000 + GST", "FAQ: ₹1,000 + GST", "Late-payment calculation also differs"] },
      { id: "two-3", priority: "P1", category: "Usability & interaction", title: "The main calculator cannot cover the advertised mid-premium loan range", issue: "The standard calculator tops out at ₹2.75 lakh, while the page describes a Mid Premium Segment program extending to ₹5 lakh with different conditions.", evidence: "Calculator maximum ₹2.75 lakh · Mid Premium program up to ₹5 lakh.", fix: "Separate the loan programs clearly and route customers to the correct calculator. If one program needs assisted processing, say so at the amount limit.", cropTitle: "Two-wheeler loan calculator", cropLines: ["Loan amount: up to ₹2.75 lakh", "Mid Premium program: up to ₹5 lakh", "No clear route between the programs"] },
      { id: "two-4", priority: "P2", category: "Usability & interaction", title: "The document checklist is not tailored to applicant type", issue: "The page lists basic KYC requirements, while the eligibility section also refers to employment/work experience. Salaried and self-employed applicants may not know what additional evidence they need.", evidence: "KYC documents listed separately from employment/work-experience criteria.", fix: "Show a checklist tailored to salaried and self-employed applicants, separating mandatory from conditional documents.", cropTitle: "Documents required", cropLines: ["KYC documents", "Passport-size photograph", "Employment proof requirements are separate"] },
      { id: "two-5", priority: "P2", category: "Language & tone", title: "The calculator disclaimer makes its own result sound unreliable", issue: "The disclaimer says the bank does not guarantee accuracy/completeness and advises customers not to rely on the output. That undermines a tool meant to provide a useful repayment estimate.", evidence: "Calculator disclaimer broadly disclaims accuracy and reliance.", fix: "Explain that results are estimates based on entered values, identify the rate/tenure assumptions and note that final terms depend on approval.", cropTitle: "EMI estimate disclaimer", cropLines: ["EMI calculator result", "Bank does not guarantee accuracy/completeness", "Do not rely on generated data"] }
    ]
  },
  {
    id: "msme",
    tab: "MSME Loans",
    title: "MSME loans",
    url: "https://www.ujjivansfb.bank.in/business/loans/msme-loans",
    findings: [
      { id: "msme-1", priority: "P1", category: "Usability & interaction", title: "The calculator cap is below several advertised product limits", issue: "The shared MSME calculator stops at ₹1 crore, while the product range includes Loan Against Property up to ₹10 crore and some supply-chain finance products between ₹5 crore and ₹50 crore.", evidence: "Calculator max ₹1 crore; LAP up to ₹10 crore; supply-chain product range ₹5–50 crore.", fix: "Create product-specific calculators with accurate amount ranges. Route larger facilities to an assisted enquiry if they cannot be estimated online.", cropTitle: "MSME loan calculator", cropLines: ["Loan amount: up to ₹1 crore", "Loan Against Property: up to ₹10 crore", "Supply-chain finance: ₹5–50 crore"] },
      { id: "msme-2", priority: "P2", category: "Information hierarchy", title: "The main page lacks a quick product-shortlisting comparison", issue: "LAP, Working Capital and Supply Chain Finance cards lead with broad benefits but don't consistently summarize amount, tenure, pricing basis, collateral and qualification in one place.", evidence: "Multiple subproducts listed as separate cards with feature copy.", fix: "Add a compact comparison grid: best for, loan range, tenure, pricing basis, collateral and eligibility. Link to detailed terms from each row.", cropTitle: "Choose an MSME loan", cropLines: ["Loan Against Property", "Working Capital", "Supply Chain Finance", "Product fit and limits need comparison"] },
      { id: "msme-3", priority: "P2", category: "Language & tone", title: "Abbreviations force customers to know banking terminology", issue: "LAP, WC and SCF are short labels for internal product concepts. Small-business owners may be looking for a funding use case rather than a banking abbreviation.", evidence: "LAP · WC · SCF", fix: "Lead with plain language such as “Borrow against business property”, “Manage day-to-day cash flow” and “Finance supplier or dealer transactions”. Show formal product names second.", cropTitle: "MSME product categories", cropLines: ["LAP  |  WC  |  SCF", "Abbreviations are the main route labels", "Customer tasks are not obvious"] },
      { id: "msme-4", priority: "P1", category: "Usability & interaction", title: "The calculator requires customers to supply their own interest-rate assumption", issue: "The EMI calculator requests a manually entered rate between 5% and 30%. Without a product-specific suggestion, the result can look precise while being based on an unsuitable rate.", evidence: "Interest rate / IRR input with 5%–30% range.", fix: "Prefill an indicative rate range based on selected product, explain the pricing assumption and label the result as an estimate.", cropTitle: "MSME EMI calculator", cropLines: ["Interest rate (IRR): 5%–30%", "User supplies rate before calculation", "Rate may not match the chosen product"] },
      { id: "msme-5", priority: "P1", category: "Language & tone", title: "Legacy emergency-credit eligibility appears inside the current LAP journey", issue: "The LAP page includes an emergency credit section that refers to loans outstanding as of 29 February 2020. This historical condition appears in current borrowing content and may make users think the scheme remains open.", evidence: "Guaranteed Emergency Credit Line eligibility tied to 29 February 2020.", fix: "Confirm the program's live status. Remove obsolete material or clearly mark it as archived information if it must remain accessible.", cropTitle: "Guaranteed Emergency Credit Line", cropLines: ["Eligibility linked to loans outstanding", "As of 29 February 2020", "Legacy scheme copy in a current product page"] }
    ]
  },
  {
    id: "current-account",
    tab: "Current Accounts",
    title: "Business current accounts",
    url: "https://www.ujjivansfb.bank.in/business/business-current-account",
    findings: [
      { id: "current-1", priority: "P2", category: "Information hierarchy", title: "Account families and sub-variants are mixed in the hierarchy", issue: "The hub lists Regular, Premium, Digital, Business Edge, Maxima and Privilege. Business Edge then introduces Flexi Next and Flexi Current as types, without a clear visual relationship to the wider product families.", evidence: "Business Edge current account contains Flexi Next and Flexi Current variants alongside other account names.", fix: "Use two levels: choose an account family, then choose variants within that family. Provide a clear comparison table for the variants.", cropTitle: "Business current accounts", cropLines: ["Regular  |  Premium  |  Digital", "Business Edge  |  Maxima  |  Privilege", "Business Edge variants: Flexi Next / Flexi Current"] },
      { id: "current-2", priority: "P1", category: "Language & tone", title: "Opening deposit and ongoing balance obligations can be confused", issue: "The product hub uses “Minimum Initial Funding”, while details also describe minimum account balance and cash-deposit limits linked to average balance. These are different obligations.", evidence: "Minimum Initial Funding vs minimum balance and cash-deposit allowance.", fix: "Show Opening Deposit, Required Monthly Average Balance and Cash-Deposit Allowance as separate fields. Explain consequences of not maintaining the required balance.", cropTitle: "Account funding and balance", cropLines: ["Minimum Initial Funding", "Minimum account balance", "Cash-deposit allowance linked to balance"] },
      { id: "current-3", priority: "P1", category: "Language & tone", title: "Cash-deposit entitlements are expressed as formulas rather than outcomes", issue: "Flexi Next and Flexi Current use different multiples of average balance and reference different calculation periods. Customers need to translate the formulas into a limit for their business.", evidence: "Cash-deposit limit calculated using prior/current month average balance multiples.", fix: "Provide worked examples or a small calculator showing the limit for representative balances, when it is measured and what happens if the balance changes.", cropTitle: "Cash deposit limits", cropLines: ["Flexi Next: limit linked to average balance", "Flexi Current: different calculation period", "Actual allowance is hard to estimate"] },
      { id: "current-4", priority: "P2", category: "Language & tone", title: "Benefits depend on conditions stated too vaguely", issue: "Phrases such as “if you maintain the proper balance” don't tell the customer which balance, over what period and how many free transactions apply.", evidence: "CMS charge waiver condition: “if you maintain the proper balance”.", fix: "State the qualifying balance, assessment period, free-transaction count and charges beyond the allowance beside the benefit claim.", cropTitle: "CMS charges and waivers", cropLines: ["Waiver on CMS charges", "If you maintain the proper balance", "Threshold and period not shown with claim"] },
      { id: "current-5", priority: "P2", category: "Usability & interaction", title: "Business constitution eligibility isn't presented as a quick check", issue: "The page lists resident individuals, sole proprietorships, partnerships, LLPs and other business types in dense eligibility content. Customers must read the details to find their route.", evidence: "Multiple eligible business constitutions in the eligibility section.", fix: "Add a “Who can apply?” summary and selector by business constitution, with a tailored document checklist for each supported business type.", cropTitle: "Who can apply?", cropLines: ["Individuals  |  Sole proprietorships", "Partnerships  |  LLPs  |  Other entities", "Eligibility requires reading detailed copy"] }
    ]
  },
  {
    id: "digital",
    tab: "Digital Banking",
    title: "Digital banking channels",
    url: "https://www.ujjivansfb.bank.in/mobile-banking",
    findings: [
      { id: "digital-1", priority: "P1", category: "Navigation", title: "EZY Mobile Banking and Hello Ujjivan need a clearer comparison", issue: "The standard mobile app and Hello Ujjivan have different audiences, languages and interaction models, but users must discover these differences across separate pages.", evidence: "EZY Mobile Banking and Hello Ujjivan appear as separate digital-banking offerings.", fix: "Create a “Choose your banking app” page comparing target customer, supported languages, core tasks, device availability and registration steps.", cropTitle: "Mobile banking options", cropLines: ["EZY Mobile Banking", "Hello Ujjivan", "Which app fits this customer and task?"] },
      { id: "digital-2", priority: "P2", category: "Usability & interaction", title: "Mobile app registration is a long procedural wall of text", issue: "Instructions cover installation, SIM selection, SMS, CIF, terms, OTP and authentication-method selection, with multiple opt-in paths. It is hard to scan for prerequisites and recovery steps.", evidence: "App installation → SIM → SMS → CIF → terms → OTP → authentication.", fix: "Summarize “What you need”, “Steps” and “If verification fails” first. Then show a numbered, illustrated flow with alternative recovery paths.", cropTitle: "Mobile banking registration", cropLines: ["Install app → choose SIM", "Send SMS → select CIF → accept terms", "OTP → choose authentication method"] },
      { id: "digital-3", priority: "P2", category: "Navigation", title: "Customers must know the channel before they know where to do a task", issue: "Mobile banking, Hello Ujjivan, WhatsApp, phone banking and other digital services are separate destinations. Users must know which channel supports a task before starting.", evidence: "Separate channel pages for common service tasks.", fix: "Add a task directory for check balance, block card, transfer money, pay EMI and update details. Recommend the fastest supported channel for each task.", cropTitle: "Digital service channels", cropLines: ["Mobile Banking  |  Hello Ujjivan", "WhatsApp Banking  |  Phone Banking", "Which channel supports my task?"] },
      { id: "digital-4", priority: "P2", category: "Information hierarchy", title: "“50+ services” promotes breadth before the customer's actual task", issue: "The WhatsApp page leads with a large service count and a starting instruction. Users still need to discover whether the channel supports the specific transaction they came to complete.", evidence: "WhatsApp Banking advertises 50+ services.", fix: "Show the top six tasks and a searchable service directory above the start instructions. Place official-number and anti-fraud guidance beside the CTA.", cropTitle: "WhatsApp Banking", cropLines: ["50+ services on WhatsApp Banking", "Message the bank to get started", "Top supported tasks are not immediately visible"] },
      { id: "digital-5", priority: "P2", category: "Language & tone", title: "Channel naming is inconsistent across instructions and menus", issue: "The standard app is called both “Mobile Banking” and “EZY Mobile Banking”, while Hello Ujjivan is separate. Customers may not know whether instructions apply to the app they use.", evidence: "Mobile Banking / EZY Mobile Banking / Hello Ujjivan.", fix: "Use canonical product names across navigation, headings, FAQs, store links and registration steps. Label the audience and link each page to the correct app.", cropTitle: "Product naming", cropLines: ["Mobile Banking", "EZY Mobile Banking", "Hello Ujjivan — distinct service"] }
    ]
  },
  {
    id: "calculators",
    tab: "Calculators",
    title: "Financial calculators",
    url: "https://www.ujjivansfb.bank.in/financial-calculators",
    findings: [
      { id: "calc-1", priority: "P2", category: "User engagement", title: "Coming-soon calculators look like destinations but cannot complete a task", issue: "The hub lists calculators for products including Gold Loan EMI and Business Loan EMI while marking some tools “Coming Soon”. Users can click into a path that does not meet the expected task.", evidence: "Gold Loan EMI and Business Loan EMI marked “Coming Soon”.", fix: "Separate available and upcoming tools. For unavailable tools, give a clear alternative such as an enquiry or assisted-calculation route.", cropTitle: "Financial calculators", cropLines: ["Gold Loan EMI — Coming Soon", "Business Loan EMI — Coming Soon", "User intent has no completion path"] },
      { id: "calc-2", priority: "P1", category: "Usability & interaction", title: "Manual interest-rate entry creates unreliable estimates", issue: "Some loan calculators require users to enter a rate before calculating EMI, even though the product rate is presented separately on the relevant product page.", evidence: "Interest rate field with a broad 5%–30% range.", fix: "Prefill an indicative rate based on selected product, show the assumption and let users adjust it. Carry the selected product and rate into the next step.", cropTitle: "Loan EMI calculator", cropLines: ["Interest rate: 5%–30%", "Enter a rate to calculate EMI", "No suggested product-specific rate"] },
      { id: "calc-3", priority: "P1", category: "Usability & interaction", title: "Calculator limits don't match all advertised product ranges", issue: "The MSME tool tops out at ₹1 crore for products extending to higher amounts; the two-wheeler calculator caps at ₹2.75 lakh while a separate program goes up to ₹5 lakh.", evidence: "MSME calculator max ₹1 crore; LAP up to ₹10 crore; two-wheeler standard calculator max ₹2.75 lakh vs mid-premium up to ₹5 lakh.", fix: "Use product-specific calculator limits and route unsupported sizes to a dedicated enquiry path. Validate limits against approved terms.", cropTitle: "Calculator amount bounds", cropLines: ["MSME calculator: up to ₹1 crore", "LAP: up to ₹10 crore", "Two-wheeler: ₹2.75 lakh vs ₹5 lakh program"] },
      { id: "calc-4", priority: "P2", category: "Navigation", title: "Repeated calculator entry points can drift out of sync", issue: "Calculators are reachable from the hub and product pages. If they have separate implementations, their bounds, assumptions or validation may diverge.", evidence: "Central calculator hub plus embedded/on-page calculator entry points.", fix: "Maintain a single shared calculator component per product and deep-link from pages with the product preselected. Keep rules and labels consistent.", cropTitle: "Calculator entry points", cropLines: ["Financial Calculators hub", "Home loan page calculator", "MSME page calculator"] },
      { id: "calc-5", priority: "P2", category: "Information hierarchy", title: "Results need an at-a-glance assumptions summary and next step", issue: "EMI or maturity values depend on amount, tenure, interest rate and payout assumptions. These details should stay visible alongside the calculated result.", evidence: "Calculator output and input assumptions are separated or require manual interpretation.", fix: "Show amount, rate, tenure, total interest and total payment together. Label estimates clearly and provide a contextual next action with inputs carried forward where possible.", cropTitle: "Calculator output", cropLines: ["Estimated EMI / maturity amount", "Review amount · rate · tenure · payout", "Proceed with the same assumptions"] }
    ]
  },
  {
    id: "branches",
    tab: "Branch Locator",
    title: "Branch locator",
    url: "https://www.ujjivansfb.bank.in/locate-us-branches",
    findings: [
      { id: "branch-1", priority: "P1", category: "Usability & interaction", title: "Some indexed city pages show “No branches available”", issue: "Search-indexed captures for Chennai, Mumbai and Bengaluru show “No branches available”. The same captures can show a “Loading map…” state, so this must be reproduced live to distinguish a real data failure from an incomplete capture.", evidence: "“No branches available” appears alongside “Loading map…” in indexed city snapshots.", fix: "Verify in a real browser. If reproducible, fix branch-data retrieval before launch and log the empty response separately from loading/error states.", cropTitle: "Branch search result", cropLines: ["City: Chennai", "No branches available", "Loading map…"] },
      { id: "branch-2", priority: "P1", category: "Usability & interaction", title: "Empty and loading states can appear at the same time", issue: "When the user sees an empty result while a map is still loading, it is unclear whether there are no branches or the request is unfinished.", evidence: "Empty state and loading message displayed together in indexed result.", fix: "Use explicit loading, success, empty and error states. Only show “No branches available” after a successful completed query.", cropTitle: "Locator status states", cropLines: ["No branches available", "Loading map…", "Two competing status messages"] },
      { id: "branch-3", priority: "P2", category: "Usability & interaction", title: "The empty state needs a recovery path that preserves the search", issue: "If a state/city/area search returns no results, the customer must figure out how to revise it. An empty message without nearby alternatives makes recovery harder.", evidence: "State, city and area selector flow with an empty result.", fix: "Keep selected values in the empty state, suggest nearby areas and offer a direct full-branch-list route.", cropTitle: "No branch results", cropLines: ["State  →  City  →  Area", "No branches available", "No nearby-area recovery shown"] },
      { id: "branch-4", priority: "P2", category: "Usability & interaction", title: "Branch details need a usable list fallback when the map fails", issue: "A map-only interaction can block customers who have slow connections, accessibility needs or a map-rendering issue.", evidence: "Branch-locator flow uses a map as a key result surface.", fix: "Always provide a list view with branch name, address, contact information, hours and directions independently of map rendering.", cropTitle: "Map and branch results", cropLines: ["Loading map…", "Branch markers / map surface", "List fallback should remain available"] },
      { id: "branch-5", priority: "P2", category: "Information hierarchy", title: "A low-value map disclaimer competes with branch-finding details", issue: "The city pages include a political-boundary disclaimer in the main task area. It is less useful to customers than address, opening hours, phone and directions.", evidence: "Map disclaimer about graphical representation and political boundaries.", fix: "Move the disclaimer into a secondary information link. Prioritize branch availability, address, hours, directions and contact details.", cropTitle: "Map disclaimer", cropLines: ["Map is for graphical representation", "Not associated with political boundaries", "Branch information should be primary"] }
    ]
  }
];

const CRITERIA = ["All criteria", "Language & tone", "Navigation", "Information hierarchy", "Visual design", "Usability & interaction", "Responsiveness", "User engagement", "Web performance"];

function EvidenceCrop({ page, finding, cropRef }: { page: AuditPage; finding: Finding; cropRef: (node: SVGSVGElement | null) => void }) {
  return (
    <svg ref={cropRef} className="ua-crop" viewBox="0 0 1200 640" role="img" aria-label={"Reconstructed evidence crop for " + finding.title} xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="640" rx="22" fill="#f8f6f2" />
      <rect width="1200" height="88" rx="22" fill="#fff" />
      <rect x="0" y="65" width="1200" height="23" fill="#fff" />
      <text x="52" y="53" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="800" fill="#a9262c">ujjivan</text>
      <text x="190" y="51" fontFamily="Arial, sans-serif" fontSize="14" fill="#6b6b6b">small finance bank</text>
      <text x="725" y="51" fontFamily="Arial, sans-serif" fontSize="17" fill="#333">Personal Banking</text>
      <text x="895" y="51" fontFamily="Arial, sans-serif" fontSize="17" fill="#333">Business</text>
      <text x="1015" y="51" fontFamily="Arial, sans-serif" fontSize="17" fill="#333">Help</text>
      <line x1="0" y1="88" x2="1200" y2="88" stroke="#dedbd5" />
      <text x="52" y="125" fontFamily="Arial, sans-serif" fontSize="14" fill="#777">HOME  /  {page.tab.toUpperCase()}</text>
      <text x="52" y="177" fontFamily="Arial, sans-serif" fontSize="30" fontWeight="700" fill="#202020">{finding.cropTitle}</text>
      <rect x="52" y="204" width="1096" height="320" rx="17" fill="#fff" stroke="#e1ddd6" />
      <rect x="76" y="228" width="1048" height="272" rx="12" fill="#fffaf2" stroke="#e9b79d" strokeWidth="2" />
      <rect x="76" y="228" width="8" height="272" rx="4" fill="#b52c32" />
      <text x="108" y="266" fontFamily="Arial, sans-serif" fontSize="13" letterSpacing="2" fontWeight="700" fill="#a9262c">PAGE CONTENT EXCERPT</text>
      {finding.cropLines.slice(0, 4).map((line, index) => (
        <text key={index} x="108" y={314 + index * 49} fontFamily="Arial, sans-serif" fontSize={index === 0 ? "26" : "23"} fontWeight={index === 0 ? "700" : "500"} fill={index === 0 ? "#252525" : "#494949"}>{line}</text>
      ))}
      <rect x="910" y="243" width="190" height="34" rx="17" fill={finding.priority === "P1" ? "#fde8e5" : "#fff4d4"} />
      <text x="1005" y="265" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="13" fontWeight="800" fill={finding.priority === "P1" ? "#a3312f" : "#805d00"}>{finding.priority} · HIGH-PRIORITY ISSUE</text>
      <line x1="52" y1="554" x2="1148" y2="554" stroke="#dedbd5" />
      <text x="52" y="589" fontFamily="Arial, sans-serif" fontSize="13" fontWeight="700" fill="#6b6b6b">RECONSTRUCTED UI EXCERPT · NOT A LITERAL BROWSER SCREENSHOT</text>
      <text x="52" y="615" fontFamily="Arial, sans-serif" fontSize="13" fill="#777">{page.tab} · ujjivansfb.bank.in</text>
    </svg>
  );
}

export default function UjjivanAuditBoard() {
  const [activePageId, setActivePageId] = useState("home");
  const [priorityFilter, setPriorityFilter] = useState("All priorities");
  const [categoryFilter, setCategoryFilter] = useState("All criteria");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, EditValues>>({});
  const [notice, setNotice] = useState("");
  const cropRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const activePage = AUDITS.find((page) => page.id === activePageId) ?? AUDITS[0];
  const filteredFindings = useMemo(() => activePage.findings.filter((finding) => {
    const edit = edits[finding.id] ?? {};
    const priorityOkay = priorityFilter === "All priorities" || finding.priority === priorityFilter;
    const categoryOkay = categoryFilter === "All criteria" || finding.category === categoryFilter;
    const haystack = [finding.title, finding.issue, finding.evidence, finding.fix, edit.title, edit.issue, edit.fix].join(" ").toLowerCase();
    return priorityOkay && categoryOkay && haystack.includes(search.toLowerCase());
  }), [activePage, priorityFilter, categoryFilter, search, edits]);

  function updateEdit(id: string, key: keyof EditValues, value: string) {
    setEdits((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), [key]: value } }));
  }

  function getText(page: AuditPage, finding: Finding) {
    const edit = edits[finding.id] ?? {};
    return [
      "UJJIVAN SFB — UX AUDIT FINDING",
      "Page: " + page.title,
      "Finding: " + (edit.title ?? finding.title),
      "Priority: " + finding.priority,
      "Assessment criterion: " + finding.category,
      "Observed UX issue: " + (edit.issue ?? finding.issue),
      "Visible evidence: " + finding.evidence,
      "Recommended fix: " + (edit.fix ?? finding.fix),
      "Source: " + page.url,
      "Evidence asset: reconstructed UI excerpt based on audited page content; not a literal browser screenshot."
    ].join("\n");
  }

  async function makePng(finding: Finding): Promise<Blob> {
    const svg = cropRefs.current[finding.id];
    if (!svg) throw new Error("The evidence crop is not ready.");
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "1200");
    clone.setAttribute("height", "640");
    const serialized = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not render the evidence crop."));
      });
      image.src = url;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable in this browser.");
      context.drawImage(image, 0, 0, 1200, 640);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("Could not create the PNG image.");
      return png;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function copyText(page: AuditPage, finding: Finding) {
    try {
      await navigator.clipboard.writeText(getText(page, finding));
      setNotice("Audit text copied.");
    } catch {
      setNotice("Clipboard text permission was blocked. Allow clipboard access for this site and try again.");
    }
  }

  async function copyImage(finding: Finding) {
    try {
      const png = await makePng(finding);
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("Image clipboard is not supported here. Use Download PNG instead.");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setNotice("Evidence crop copied as PNG.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not copy this image. Try Download PNG.");
    }
  }

  async function copyBoth(page: AuditPage, finding: Finding) {
    try {
      const png = await makePng(finding);
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("Clipboard does not support image + text together here.");
      const textBlob = new Blob([getText(page, finding)], { type: "text/plain" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png, "text/plain": textBlob })]);
      setNotice("Image and audit text copied together. Paste into your target app.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not copy both. Use Copy image and Copy text separately.");
    }
  }

  async function downloadPng(finding: Finding) {
    try {
      const png = await makePng(finding);
      const url = URL.createObjectURL(png);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ujjivan-" + finding.id + "-evidence.png";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("PNG downloaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not download this image.");
    }
  }

  async function copyPageText() {
    const text = [activePage.title + " — Ujjivan SFB UX Audit", activePage.url, "", ...filteredFindings.map((finding) => getText(activePage, finding))].join("\n\n--------------------------------\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice("All visible findings for " + activePage.tab + " copied.");
    } catch {
      setNotice("Clipboard text permission was blocked. Allow clipboard access for this site and try again.");
    }
  }

  return (
    <main className="ua-shell">
      <header className="ua-topbar">
        <a className="ua-brand" href="/" aria-label="UX Audit home"><span className="ua-brand-mark">UX</span><span><strong>Audit Board</strong><small>ScreenRoot · Ujjivan SFB</small></span></a>
        <div className="ua-topbar-right"><span className="ua-status-dot" /> <span>Evidence-led review</span><a href={activePage.url} target="_blank" rel="noreferrer">Open live page ↗</a></div>
      </header>

      <section className="ua-hero">
        <div className="ua-eyebrow">INDIAN BFCI · WEBSITE REVAMP</div>
        <h1>Ujjivan SFB <span>UX findings</span></h1>
        <p>Browse each page, refine the copy, then copy the visual crop and audit text directly into your presentation, Figma or Miro.</p>
        <div className="ua-stats">
          <div><strong>{AUDITS.length}</strong><span>page tabs</span></div>
          <div><strong>{AUDITS.reduce((sum, page) => sum + page.findings.length, 0)}</strong><span>findings</span></div>
          <div><strong>{AUDITS.reduce((sum, page) => sum + page.findings.filter((finding) => finding.priority === "P1").length, 0)}</strong><span>P1 findings</span></div>
          <div className="ua-stat-note">Use <b>Copy both</b> for clipboard content, or download the crop as PNG.</div>
        </div>
      </section>

      <section className="ua-board">
        <div className="ua-tab-row" role="tablist" aria-label="Ujjivan page tabs">
          {AUDITS.map((page) => <button key={page.id} className={"ua-page-tab " + (activePageId === page.id ? "is-active" : "")} role="tab" aria-selected={activePageId === page.id} onClick={() => { setActivePageId(page.id); setNotice(""); }}>{page.tab}<span>{page.findings.length}</span></button>)}
        </div>

        <div className="ua-toolbar">
          <div className="ua-page-heading"><div className="ua-overline">CURRENT PAGE</div><h2>{activePage.title}</h2><a href={activePage.url} target="_blank" rel="noreferrer">{activePage.url.replace("https://www.", "")} ↗</a></div>
          <div className="ua-filters">
            <input aria-label="Search findings" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search findings…" />
            <select aria-label="Filter by priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option>All priorities</option><option value="P1">P1 · High priority</option><option value="P2">P2 · Important</option></select>
            <select aria-label="Filter by assessment criterion" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>{CRITERIA.map((criterion) => <option key={criterion}>{criterion}</option>)}</select>
            <button className="ua-button ua-button-dark" onClick={copyPageText}>Copy page text</button>
          </div>
        </div>

        <div className="ua-crop-note"><span>i</span><p><strong>About these visual crops:</strong> they are reconstructed excerpts of the audited page content, not literal browser screenshots. Each card links to the live source page. Use these crops for copy-ready issue framing; capture a live browser screenshot when a literal screenshot is required.</p></div>

        <div className="ua-findings">
          {filteredFindings.map((finding, index) => {
            const edit = edits[finding.id] ?? {};
            return (
              <article className="ua-finding-card" key={finding.id}>
                <div className="ua-card-head">
                  <div className="ua-title-group"><span className={"ua-priority " + (finding.priority === "P1" ? "p1" : "p2")}>{finding.priority}</span><span className="ua-criterion">{finding.category}</span></div>
                  <span className="ua-finding-count">{String(index + 1).padStart(2, "0")} / {String(filteredFindings.length).padStart(2, "0")}</span>
                </div>
                <input className="ua-title-edit" aria-label="Edit finding title" value={edit.title ?? finding.title} onChange={(event) => updateEdit(finding.id, "title", event.target.value)} />
                <div className="ua-crop-wrap">
                  <EvidenceCrop page={activePage} finding={finding} cropRef={(node) => { cropRefs.current[finding.id] = node; }} />
                </div>
                <div className="ua-edit-grid">
                  <label><span>Observed UX issue <em>editable</em></span><textarea value={edit.issue ?? finding.issue} onChange={(event) => updateEdit(finding.id, "issue", event.target.value)} rows={3} /></label>
                  <label><span>Recommended fix <em>editable</em></span><textarea value={edit.fix ?? finding.fix} onChange={(event) => updateEdit(finding.id, "fix", event.target.value)} rows={3} /></label>
                </div>
                <div className="ua-evidence-row"><div><span className="ua-overline">VISIBLE EVIDENCE</span><p>{finding.evidence}</p></div><a href={activePage.url} target="_blank" rel="noreferrer">Open source ↗</a></div>
                <div className="ua-card-actions">
                  <button className="ua-button ua-button-dark" onClick={() => copyBoth(activePage, finding)}>Copy both</button>
                  <button className="ua-button" onClick={() => copyImage(finding)}>Copy image</button>
                  <button className="ua-button" onClick={() => copyText(activePage, finding)}>Copy text</button>
                  <button className="ua-button ua-button-quiet" onClick={() => downloadPng(finding)}>Download PNG ↓</button>
                </div>
              </article>
            );
          })}
          {filteredFindings.length === 0 && <div className="ua-empty"><strong>No findings match these filters.</strong><p>Clear the search or choose another criterion/priority.</p><button className="ua-button" onClick={() => { setSearch(""); setPriorityFilter("All priorities"); setCategoryFilter("All criteria"); }}>Reset filters</button></div>}
        </div>
        <footer className="ua-footer"><span>UX Audit Board · Ujjivan Small Finance Bank</span><a href={activePage.url} target="_blank" rel="noreferrer">Verify against the live page ↗</a></footer>
      </section>
      {notice && <div className="ua-toast" role="status" onClick={() => setNotice("")}><span>✓</span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    </main>
  );
}
