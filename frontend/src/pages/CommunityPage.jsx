import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import NearbyCommunityIssues from '../components/NearbyCommunityIssues';
import { addCommunityComment, addProblemComment, getCommunityPosts, getCommunityProblem, markCommunityCommentHelpful, submitCommunityConfirmation } from '../services/api';

function profile() {
  try { return JSON.parse(localStorage.getItem('kisaansathi_farmer_profile') || 'null'); } catch { return null; }
}

function timeLabel(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function FarmerIdentity({ author }) {
  const name = author?.name || 'Farmer';
  return <div className="community-identity"><span className="community-avatar">{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><span>{author?.crop || 'Farmer experience'}</span></div></div>;
}

function CommentList({ comments, onHelpful }) {
  return <div className="community-comments">{comments?.map((comment) => (
    <article className={`community-comment ${comment.is_officer ? 'community-comment-officer' : ''}`} key={comment.id}>
      <FarmerIdentity author={comment.author} />
      {comment.is_officer && <div className="aeo-verified-badge">✓ AEO VERIFIED <span>{comment.officer?.name || 'Agricultural Extension Officer'}</span></div>}
      <p>{comment.content}</p>
      <div className="community-comment-meta"><button type="button" onClick={() => onHelpful(comment.id)}>👍 Helpful <b>{comment.helpful_count || 0}</b></button><span>{timeLabel(comment.created_at)}</span></div>
    </article>
  ))}</div>;
}

function PostCard({ post, onHelpful }) {
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const submitComment = async (event) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setPosting(true); setError('');
    try { await onHelpful(null, post.id, comment.trim()); setComment(''); } catch (err) { setError(err.message); } finally { setPosting(false); }
  };
  return <article className="community-post-card">
    <div className="community-post-head"><FarmerIdentity author={post.author} /><span className="community-time">{timeLabel(post.created_at)}</span></div>
    <div className="community-post-tags">{post.crop && <span className="community-crop-tag">🌱 {post.crop}</span>}{post.related_problem && <span className="community-related-tag">Related to reported agricultural problem</span>}</div>
    <p className="community-post-content">{post.content}</p>
    {post.photo_url && <img className="community-post-photo" src={post.photo_url} alt="Farmer shared crop" />}
    <div className="community-post-summary">👍 {post.helpful_count || 0} helpful <span>💬 {post.comment_count || 0} comments</span></div>
    <CommentList comments={post.comments} onHelpful={onHelpful} />
    <form className="community-comment-form" onSubmit={submitComment}><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your experience" maxLength={1000} /><button className="btn btn-primary" disabled={posting}>{posting ? 'Posting...' : 'Comment'}</button></form>
    {error && <p className="community-form-error">{error}</p>}
  </article>;
}

function CommunityHome() {
  const navigate = useNavigate(); const [posts, setPosts] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const currentProfile = profile(); const [searchLocation, setSearchLocation] = useState({ latitude: currentProfile?.latitude, longitude: currentProfile?.longitude });
  const load = () => { setLoading(true); getCommunityPosts().then((data) => setPosts(data.posts || [])).catch((err) => setError(err.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  useEffect(() => {
    if ((searchLocation.latitude == null || searchLocation.longitude == null) && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => setSearchLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }));
    }
  }, [searchLocation.latitude, searchLocation.longitude]);
  const interaction = async (commentId, postId, content) => { if (commentId) { await markCommunityCommentHelpful(commentId); load(); } else { await addCommunityComment(postId, content); load(); } };
  return <main className="community-page"><header className="community-hero"><div><span className="community-kicker">KisaanSathi field network</span><h1>👥 Farmer Community</h1><p>Problems reported by farmers near you, with space to learn from each experience.</p></div><Link to="/report" className="btn btn-primary">Report a problem</Link></header><nav className="community-page-tabs" aria-label="Farmer pages"><Link to="/my-issues">📋 My Issues</Link><Link className="active" to="/community">👥 Farmer Community</Link></nav>{!currentProfile && <div className="community-session-note">Report a problem once to create your farmer profile. Your reports will then appear here for nearby farmers.</div>}<section className="community-section"><div className="community-section-heading"><div><span className="community-kicker">Structured field reports</span><h2>🔥 Problems Near You</h2></div><span className="community-trust-note">Only approximate locality and a 3 km radius are shown.</span></div><NearbyCommunityIssues latitude={searchLocation.latitude} longitude={searchLocation.longitude} crop={currentProfile?.crop} farmerPhone={currentProfile?.phone} farmerName={currentProfile?.name} onSelectExistingIssue={(issue) => navigate(`/community/problems/${issue.id}`)} /></section><section className="community-section"><div className="community-section-heading"><div><span className="community-kicker">Discussion on reported problems</span><h2>💬 Farmer Experiences</h2></div><span className="community-trust-note">Helpful counts are trust signals, not proof of correctness.</span></div>{loading ? <div className="community-state">Loading farmer experiences...</div> : error ? <div className="community-state community-error">{error}</div> : posts.length ? posts.map((post) => <PostCard key={post.id} post={post} onHelpful={interaction} />) : <div className="community-state">Open a nearby problem to read and add farmer experiences.</div>}</section></main>;
}

function ProblemPage() {
  const { problemId } = useParams(); const navigate = useNavigate(); const [data, setData] = useState(null); const [error, setError] = useState(''); const [confirmed, setConfirmed] = useState(false); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { getCommunityProblem(problemId).then((result) => setData(result.problem)).catch((err) => setError(err.message)); }, [problemId]);
  if (error) return <main className="community-page"><div className="community-state community-error">{error}</div></main>;
  if (!data) return <main className="community-page"><div className="community-state">Loading agricultural problem...</div></main>;
  const currentProfile = profile(); const submitMeToo = async () => { setBusy(true); try { await submitCommunityConfirmation({ incidentId: problemId, farmerPhone: currentProfile?.phone, farmerName: currentProfile?.name, latitude: currentProfile?.latitude, longitude: currentProfile?.longitude }); setConfirmed(true); setData({ ...data, community_confirmations_count: (data.community_confirmations_count || 0) + 1 }); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const submitComment = async (event) => { event.preventDefault(); if (!comment.trim()) return; try { await addProblemComment(problemId, comment.trim()); const result = await getCommunityProblem(problemId); setData(result.problem); setComment(''); } catch (err) { setError(err.message); } };
  return <main className="community-page"><button className="community-back" type="button" onClick={() => navigate(-1)}>← Back to community</button><article className="problem-detail"><div className="problem-detail-header"><span className="community-crop-tag">🌱 {data.crop}</span><span>{data.locality}</span></div><h1>{data.description}</h1><p className="problem-meta">Reported by {data.farmer_name} · {timeLabel(data.created_at)} · Current status: {data.status}</p>{data.photo_url && <img className="problem-photo" src={data.photo_url} alt="Original crop problem" />}<div className="me-too-panel"><h2>Are you experiencing this problem too?</h2><button type="button" className="btn btn-primary btn-me-too-large" onClick={submitMeToo} disabled={busy || confirmed || !currentProfile?.phone}>{confirmed ? '✓ Me Too recorded' : '🌱 ME TOO'}</button><span>{data.community_confirmations_count || 0} farmers confirmed</span>{!currentProfile?.phone && <small>Enter your phone on My Issues first to link your farmer profile.</small>}</div><section className="issue-journey-panel"><div className="aeo-advice-title">📍 YOUR ISSUE JOURNEY</div><div className="issue-journey-list">{(data.timeline || []).map((event, index) => <div className="issue-journey-event" key={`${event.timestamp || event.label}-${index}`}><span className="issue-journey-dot">{index + 1}</span><div><strong>{event.label || event.status || 'Update'}</strong><span>{event.timestamp ? timeLabel(event.timestamp) : ''}</span>{event.note && <p>{event.note}</p>}</div></div>)}</div></section><section className="aeo-advice-panel"><div className="aeo-advice-title">🌾 AEO VERIFIED ADVICE</div>{data.advisory?.localized_advisory || data.advisory?.original_advisory ? <><p>{data.advisory.localized_advisory || data.advisory.original_advisory}</p><strong>✓ Verified by Agricultural Extension Officer</strong></> : <p>An AEO has not posted an official recommendation yet.</p>}</section><section className="problem-discussion"><h2>💬 What are farmers saying?</h2><CommentList comments={data.posts?.flatMap((post) => post.comments || [])} onHelpful={markCommunityCommentHelpful} /><form className="community-comment-form" onSubmit={submitComment}><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share what worked for you" maxLength={1000} /><button className="btn btn-primary">Share my opinion</button></form></section>{error && <p className="community-form-error">{error}</p>}</article></main>;
}

export default function CommunityPage() { return useParams().problemId ? <ProblemPage /> : <CommunityHome />; }
