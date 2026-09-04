import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getMyIssues } from '../services/api';

export default function MyIssuesPage() {
  const navigate = useNavigate();
  const [issues, setIssues] = useState([]);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadIssues = (farmerPhone = null) => {
    setLoading(true); setError('');
    getMyIssues(30, farmerPhone).then((data) => {
      setIssues(data.incidents || []);
      if (data.farmer?.id && farmerPhone) {
        localStorage.setItem('kisaansathi_farmer_profile', JSON.stringify({ farmer_id: data.farmer.id, name: data.farmer.name, phone: farmerPhone, latitude: data.farmer.latitude, longitude: data.farmer.longitude }));
      }
    }).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { try { if (JSON.parse(localStorage.getItem('kisaansathi_farmer_profile') || 'null')?.farmer_id) loadIssues(); else setLoading(false); } catch { setLoading(false); } }, []);
  const lookupFarmer = (event) => { event.preventDefault(); if (!phone.trim() || phone.replace(/\D/g, '').length < 10) { setError('Please enter a valid 10-digit Indian mobile number.'); return; } loadIssues(phone.trim()); };
  return <main className="community-page my-issues-page">
    <header className="community-hero"><div><span className="community-kicker">Your farmer profile</span><h1>📋 My Issues</h1><p>Problems you have reported to your Agricultural Extension Officer.</p></div><Link to="/report" className="btn btn-primary">Report a problem</Link></header>
    <nav className="community-page-tabs" aria-label="Farmer pages"><Link className="active" to="/my-issues">📋 My Issues</Link><Link to="/community">👥 Farmer Community</Link></nav>
    {!loading && !issues.length && error === 'A farmer profile is required.' && <form className="farmer-profile-lookup" onSubmit={lookupFarmer}><h2>Find your farmer profile</h2><p>Enter the mobile number used when you reported a problem.</p><div className="community-comment-form"><input aria-label="Mobile number" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="10-digit mobile number" maxLength={14} /><button className="btn btn-primary">Find my issues</button></div></form>}
    {!loading && !issues.length && !error && !JSON.parse(localStorage.getItem('kisaansathi_farmer_profile') || 'null')?.farmer_id && <form className="farmer-profile-lookup" onSubmit={lookupFarmer}><h2>Find your farmer profile</h2><p>Enter the mobile number used when you reported a problem.</p><div className="community-comment-form"><input aria-label="Mobile number" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="10-digit mobile number" maxLength={14} /><button className="btn btn-primary">Find my issues</button></div></form>}
    {loading && <div className="community-state">Loading your reported issues...</div>}
    {!loading && error && <div className="community-state community-error">{error}</div>}
    {!loading && !error && !issues.length && <div className="community-state">No issues reported yet. Your first report will also help nearby farmers recognize similar problems.</div>}
    <div className="my-issues-list">{issues.map((issue) => <article className="my-issue-card" key={issue.id} onClick={() => navigate(`/community/problems/${issue.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/community/problems/${issue.id}`); }} role="button" tabIndex={0}><div><div className="community-post-tags">{issue.crop && <span className="community-crop-tag">🌱 {issue.crop}</span>}<span className={`issue-status issue-status-${String(issue.status || '').toLowerCase()}`}>{issue.status || 'NEW'}</span></div><h2>{issue.description}</h2><p>Reported {issue.created_at ? new Date(issue.created_at).toLocaleDateString() : 'recently'} · Open journey and AEO advice →</p></div>{(issue.photo_url || issue.photos?.[0]) && <img src={issue.photo_url || issue.photos[0]} alt="Your reported crop problem" />}</article>)}</div>
  </main>;
}