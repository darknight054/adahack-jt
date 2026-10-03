export default function Avatar({ person, colour, small }) {
  return (
    <span className={small ? 'avatar small' : 'avatar'} style={colour ? { '--team': colour } : undefined} title={person.name}>
      {person.initials}
    </span>
  )
}
