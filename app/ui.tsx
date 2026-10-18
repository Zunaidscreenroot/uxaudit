"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={`uxd-button uxd-button-${variant} uxd-button-${size} ${className}`.trim()} {...props} />;
}

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
  className?: string;
  children: ReactNode;
}) {
  return <span className={`uxd-badge ${tone} ${className}`.trim()}>{children}</span>;
}

export function Card({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={`uxd-card ${className}`.trim()} {...props}>{children}</section>;
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`uxd-page-heading ${className}`.trim()}>
      <div>
        {eyebrow && <div className="uxd-page-eyebrow">{eyebrow}</div>}
        <h1 className="uxd-page-title">{title}</h1>
        {description && <p className="uxd-page-description">{description}</p>}
      </div>
      {actions && <div className="uxd-page-heading-actions">{actions}</div>}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  className = "",
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const fieldId = id || props.name || label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className={`uxd-field ${className}`.trim()}>
      <label className="uxd-field-label" htmlFor={fieldId}>{label}</label>
      <input id={fieldId} className="uxd-input" aria-invalid={Boolean(error)} aria-describedby={hint || error ? fieldId + "-help" : undefined} {...props} />
      {(hint || error) && <div id={fieldId + "-help"} className={error ? "uxd-field-error" : "uxd-field-hint"}>{error || hint}</div>}
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="uxd-empty-state">
      <span className="uxd-empty-state-mark">✦</span>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
