use crate::models::ReplayGainAnalysis;
use ebur128::{EbuR128, Mode};
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use symphonia::core::audio::sample::Sample;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

const TARGET_LOUDNESS_LUFS: f64 = -18.0;

pub(crate) fn analyze_track(
    job_id: String,
    path: &Path,
    cancelled: &AtomicBool,
    mut on_progress: impl FnMut(f32),
) -> Result<ReplayGainAnalysis, String> {
    let file = Box::new(File::open(path).map_err(|error| error.to_string())?);
    let source = MediaSourceStream::new(file, Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            source,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|error| error.to_string())?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| "No decodable audio track was found".to_string())?;
    let track_id = track.id;
    let total_frames = track.num_frames;
    let codec_parameters = track
        .codec_params
        .as_ref()
        .and_then(|parameters| parameters.audio())
        .ok_or_else(|| "Audio codec parameters are missing".to_string())?
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&codec_parameters, &AudioDecoderOptions::default())
        .map_err(|error| error.to_string())?;

    let mut analyzer: Option<EbuR128> = None;
    let mut analyzer_spec: Option<(u32, u32)> = None;
    let mut samples = Vec::<f32>::new();
    let mut sample_count = 0_u64;
    let mut last_progress = 0.0_f32;
    let mut last_progress_at = Instant::now();
    on_progress(0.0);

    while let Some(packet) = format.next_packet().map_err(|error| error.to_string())? {
        if cancelled.load(Ordering::Relaxed) {
            return Err("ReplayGain analysis cancelled".to_string());
        }
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(error.to_string()),
        };
        let spec = decoded.spec();
        let channels = u32::try_from(spec.channels().count())
            .map_err(|_| "Unsupported channel count".to_string())?;
        if channels == 0 || spec.rate() == 0 {
            return Err("Invalid decoded audio format".to_string());
        }
        if analyzer.is_none() {
            analyzer = Some(
                EbuR128::new(channels, spec.rate(), Mode::I | Mode::TRUE_PEAK)
                    .map_err(|error| error.to_string())?,
            );
            analyzer_spec = Some((channels, spec.rate()));
        } else if analyzer_spec != Some((channels, spec.rate())) {
            return Err("Audio format changed during ReplayGain analysis".to_string());
        }

        samples.resize(decoded.samples_interleaved(), f32::MID);
        decoded.copy_to_slice_interleaved(&mut samples);
        analyzer
            .as_mut()
            .expect("analyzer is initialized")
            .add_frames_f32(&samples)
            .map_err(|error| error.to_string())?;
        sample_count += u64::try_from(samples.len() / channels as usize).unwrap_or_default();

        if let Some(total) = total_frames.filter(|total| *total > 0) {
            let progress = (sample_count as f64 / total as f64).clamp(0.0, 1.0) as f32;
            if progress - last_progress >= 0.01
                && last_progress_at.elapsed() >= Duration::from_millis(100)
            {
                on_progress(progress);
                last_progress = progress;
                last_progress_at = Instant::now();
            }
        }
    }

    if cancelled.load(Ordering::Relaxed) {
        return Err("ReplayGain analysis cancelled".to_string());
    }
    let analyzer = analyzer.ok_or_else(|| "Decoded audio contains no samples".to_string())?;
    if sample_count == 0 {
        return Err("Decoded audio contains no samples".to_string());
    }
    let loudness_lufs = analyzer
        .loudness_global()
        .map_err(|error| error.to_string())?;
    let (channels, _) = analyzer_spec.expect("analyzer spec is initialized");
    let mut peak = 0.0_f64;
    for channel in 0..channels {
        peak = peak.max(
            analyzer
                .true_peak(channel)
                .map_err(|error| error.to_string())?,
        );
    }
    on_progress(1.0);

    Ok(ReplayGainAnalysis {
        job_id,
        path: path.to_string_lossy().to_string(),
        loudness_lufs,
        sample_count,
        peak,
        track_gain: format_gain(loudness_lufs),
        track_peak: format_peak(peak),
        reference_loudness: "-18 LUFS".to_string(),
    })
}

fn format_gain(loudness_lufs: f64) -> String {
    format!("{:.2} dB", TARGET_LOUDNESS_LUFS - loudness_lufs)
}

fn format_peak(peak: f64) -> String {
    format!("{:.6}", peak.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_mobile_compatible_replay_gain_values() {
        assert_eq!(format_gain(-9.5), "-8.50 dB");
        assert_eq!(format_peak(0.9876544), "0.987654");
        assert_eq!(format_peak(-0.1), "0.000000");
    }

    #[test]
    fn analyzes_configured_audio_fixture() {
        let Ok(path) = std::env::var("LYRICO_REPLAY_GAIN_FIXTURE") else {
            return;
        };
        let cancelled = AtomicBool::new(false);
        let analysis = analyze_track("fixture".into(), Path::new(&path), &cancelled, |_| {})
            .expect("fixture should be decoded and analyzed");

        assert!(analysis.sample_count > 0);
        assert!(analysis.loudness_lufs.is_finite());
        assert!(analysis.peak >= 0.0);
        assert_eq!(analysis.reference_loudness, "-18 LUFS");
    }
}
