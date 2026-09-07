using System;
using UnityEngine;

namespace FourBros.Display
{
    // Local restore envelope, not a public transport schema. Unity inline serialization turns
    // null class fields into empty objects and null strings into empty strings. Presence bits
    // preserve the distinction without allowing malformed external snapshots through validation.
    internal static class DisplaySnapshotJson
    {
        [Serializable] private sealed class RestoreEnvelope
        {
            public DisplaySnapshot snapshot;
            public bool hasEffect, hasTransition;
            public bool[] hasDrawn;
        }

        internal static DisplaySnapshot RoundTrip(DisplaySnapshot current)
        {
            DisplayValidation.Validate(current);
            var envelope = new RestoreEnvelope
            {
                snapshot = current, hasEffect = current.effect != null,
                hasTransition = current.handTransition != null, hasDrawn = new bool[current.slots.Length]
            };
            for (int i = 0; i < current.slots.Length; i++) envelope.hasDrawn[i] = current.slots[i].drawn != null;
            var restored = JsonUtility.FromJson<RestoreEnvelope>(JsonUtility.ToJson(envelope));
            if (!restored.hasEffect) restored.snapshot.effect = null;
            if (!restored.hasTransition) restored.snapshot.handTransition = null;
            for (int i = 0; i < restored.snapshot.slots.Length; i++)
                if (!restored.hasDrawn[i]) restored.snapshot.slots[i].drawn = null;
            DisplayValidation.Validate(restored.snapshot);
            return restored.snapshot;
        }
    }
}
