import React from 'react';

export default function Toast({ text, kind = 'ok' }) {
  return <div className={`toast ${kind}`}>{text}</div>;
}
