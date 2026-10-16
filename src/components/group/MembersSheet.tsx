"use client";

import { Group } from "@/lib/types";
import { Sheet } from "@/components/kit/Sheet";
import { List, Row, RowButton, Section } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { IconTile } from "@/components/kit/Tile";
import { SwipeRow } from "@/components/kit/SwipeRow";

/**
 * Who is in the group. Admins add people from the top rows and remove someone
 * by swiping or tapping their row — both open the screen's confirmation, which
 * warns about any balance they still carry. No inline red button per row.
 */
export default function MembersSheet({
  group,
  currentUid,
  isAdmin,
  memberName,
  onInvite,
  onAddMember,
  onRemove,
  onClose,
}: {
  group: Group;
  currentUid: string;
  isAdmin: boolean;
  memberName: (uid: string) => string;
  onInvite: () => void;
  onAddMember: () => void;
  onRemove: (uid: string) => void;
  onClose: () => void;
}) {
  const count = group.memberIds.length;

  return (
    <Sheet
      title="Members"
      subtitle={`${count} ${count === 1 ? "person" : "people"} · ${group.name}`}
      onClose={onClose}
    >
      <Section tight>
        <List>
          <RowButton
            onClick={onInvite}
            leading={<IconTile icon="qrcode" color="var(--blue)" />}
            title="Invite with Link or QR Code"
            action
          />
          {isAdmin && (
            <RowButton
              onClick={onAddMember}
              leading={<IconTile icon="person.badge.plus" color="var(--green)" />}
              title="Add Someone on SplitIt"
              action
            />
          )}
        </List>
      </Section>

      <Section header="In this group" footer={isAdmin ? "Swipe or tap someone to remove them." : undefined}>
        <List>
          {group.memberIds.map((uid) => {
            const m = group.members[uid];
            const name = m?.displayName || "Member";
            const removable = isAdmin && uid !== group.createdBy;
            const common = {
              inset: "avatar" as const,
              leading: <Avatar name={name} photoURL={m?.photoURL} size={40} />,
              title: uid === currentUid ? `${name} (You)` : memberName(uid),
              subtitle: m?.email || undefined,
              trailing: uid === group.createdBy ? <span className="capsule is-gray">Admin</span> : undefined,
            };
            if (!removable) return <Row key={uid} {...common} />;
            return (
              <SwipeRow
                key={uid}
                inset={68}
                actions={[{ label: "Remove", icon: "trash", color: "var(--red)", onAction: () => onRemove(uid) }]}
              >
                <RowButton {...common} onClick={() => onRemove(uid)} ariaLabel={`Remove ${memberName(uid)}`} />
              </SwipeRow>
            );
          })}
        </List>
      </Section>
    </Sheet>
  );
}
